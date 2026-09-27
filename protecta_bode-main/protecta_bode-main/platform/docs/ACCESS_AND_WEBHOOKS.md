# Protecta Bode access, onboarding and webhooks

This guide describes the current portal roles and integration contracts. The `/` route uses the original Protecta Bode campaign landing page from `protectabode-landing.html`; it links to the customer quote flow and portal sign-in.

## Sign-in and onboarding

### One sign-in for every role

All users use the same role-neutral sign-in screen at `/login`. Password login accepts the registered phone number or email address, and **Sign in with WhatsApp** sends a one-time code to the phone on an existing account. Both flows return the same platform session; the backend checks the role and opens the customer, agent, broker or operations workspace assigned to that account. There are no separate staff or agent sign-in choices.

For WhatsApp login, the portal calls `POST /api/v1/auth/request-whatsapp-otp` with `phone`, then submits the six-digit code to `POST /api/v1/auth/verify-whatsapp-otp`. Only active platform accounts can receive a code, requests do not disclose whether a number is registered, and a code expires after ten minutes and is single-use.

### Customers

1. From the sign-in form, choose **Create an account or set up / reset your password**.
2. Enter a phone number. A first-time customer also enters an email address and name; the account is always created with the `customer` role.
3. Verify the one-time code delivered to that email and set a password of at least 12 characters. Existing accounts receive codes only at the email already registered to that account; the entered address cannot replace it.
4. Sign in using the registered phone number or email and the new password. In `APP_ENV=sandbox`, the API returns `debug_code` for the setup flow. Production requires configured SMTP delivery.

The account-setup flow is `POST /api/v1/auth/request-otp` then `POST /api/v1/auth/verify-otp` with `phone`, `code`, and a new `password`; first-time customers also provide `full_name`. OTP verification always sets/resets the password rather than logging in passwordlessly. Codes are valid for 10 minutes. A password reset uses the same code flow and only updates the password after successful verification.

A visitor can create a public quote before signing in. To pay an unassigned public quote, the policyholder must sign in or create a customer account; successful checkout attaches the quote to that customer so the payment callback can issue the policy to the right account. Login returns the customer to their quote. Partner-created quotes are already linked to their partner's customer and remain shareable through the quote URL.

### Agents and brokers

1. An administrator signs in through the same form and opens **User access**.
2. Create a broker with full name, international phone number, email, licence number and an initial password. Create an agent with the same details, and optionally assign the agent to an active broker. Phone numbers are unique; licence numbers cannot be reused.
3. Share the phone/email username and initial password through a secure channel. The new user uses the same `/login` form; the backend detects the agent/broker role and opens the appropriate workspace. These roles cannot be self-selected during customer registration.

The admin API is `POST /api/v1/users/onboard`; `GET /api/v1/users/distribution` returns the broker/agent directory. Both require an admin bearer token.

### Staff

Administrators, underwriters and claims handlers use the same username/password sign-in. First-install admin credentials are printed by `./install.sh admin`; change the default immediately. The returned account role drives available staff menus and operations. Agency/broker provisioning and integration secrets are admin-only.

### KYC

After customer account setup, the portal opens **Verify identity** and requests a session through `POST /api/v1/kyc/session`. This calls Kabila's `POST /api/v2/verify/initialize`, saves the session to the customer account, and displays the generated URL to open or copy. Configure `KYC_API_KEY` after completing the KYC service setup or the link cannot be generated. The customer can instead request manual verification; that creates a helpdesk ticket for the team to contact them with approved next steps. ID images are not submitted to or stored in the Protecta Bode portal. Under the subdomain, KYC is served at `https://<DOMAIN>/kyc/`; the direct Docker port is `http://<VPS-IP>:18081/kyc/` by default. Opening the port root redirects to `/kyc/`.

## Webhook directions

There are two distinct flows:

- **Inbound to Protecta Bode:** payment providers call the signed payment callback; Meta/WhatsApp calls the bot callback at `/webhook`; partners can also call the authenticated Partner API.
- **Outbound from Protecta Bode:** events for partner-originated quotes and their downstream payment, policy and claim changes are posted to the partner callback configured under **Staff > Integrations**.

### Inbound payment-provider callbacks

The callback URL is:

```text
POST https://<DOMAIN>/api/v1/payments/webhook/{provider}
```

`{provider}` is `mtn_momo`, `airtel_money` or `bank`, and must match the provider on the payment record. Send a JSON body such as:

```json
{
  "payment_ref": "PM-ABC123",
  "provider_ref": "provider-transaction-id",
  "outcome": "success",
  "amount": 375000
}
```

`outcome` is `success` or `failed`; `amount` is optional but, when present, must match the payment amount in UGX. The callback signs the exact UTF-8 request body with HMAC-SHA256 using `PAYMENT_WEBHOOK_SECRET` and sends:

```text
X-PB-Signature: sha256=<lowercase-hex-digest>
```

The installer generates a random `PAYMENT_WEBHOOK_SECRET` in `.env`. Configure that same value in the payment aggregator's callback settings; keep it out of source control and browser code. Production callbacks are rejected if the secret is not configured or the signature/provider/amount does not match. Sandbox accepts unsigned callbacks only when no test secret is set. A repeated successful provider callback is safe to retry; the policy issuance is idempotent.

### WhatsApp callback into the bot

Set the Meta WhatsApp Cloud API callback URL to:

```text
https://<DOMAIN>/webhook
```

The Caddy container routes GET verification and POST message notifications to `bot:8011`. Configure `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` in `.env`. If AgriLink's Caddy already owns ports 80/443, do not start a second Caddy; add the `/webhook` route from `platform/caddy/Caddyfile` to the existing front door.

### WhatsApp passwordless sign-in (Evolution API)

The portal's **Sign in with WhatsApp** flow is separate from the inbound Meta Cloud API bot. Configure all three backend-only values in `platform/.env` and restart/rebuild the API:

```dotenv
EVOLUTION_API_URL=https://evolution.example.com
EVOLUTION_API_KEY=<server-side API key>
EVOLUTION_INSTANCE=<connected WhatsApp instance>
```

The API posts to `/message/sendText/{instance}` with an `apikey` header and an international phone number as digits (no leading `+`). The portal never receives the Evolution API key. Only existing, active platform accounts can complete this login; requests use the phone number already registered on the account. Codes expire after 10 minutes, are single-use, and lock after five incorrect attempts. Production sends no code in the API response; sandbox displays a test code only when Evolution delivery is not configured. Keep `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` (Meta bot) distinct from the `EVOLUTION_*` credentials.

### Partner API client credentials

An administrator creates an integration in **Staff > Integrations** or `POST /api/v1/integrations/partners`. The response shows `client_id` and `client_secret` once. Store them in the external server's secret store. Obtain a short-lived token:

```http
POST /api/v1/partner/auth/token
Content-Type: application/json

{"client_id":"pb_...","client_secret":"..."}
```

Use the returned bearer token for `/api/v1/partner/*` requests. Customer lookup requires a customer link owned by that partner; quote creation requires one of its linked customers; quote bind requires that partner's quote; payments and commission reports are filtered through that partner's quotes/policies; and claims require a policy from that partner's quote. Attempts to look up another partner's customer, quote, payment, report data or policy do not expose it. Partner quote IDs are the same random 15-digit numeric IDs used in portal URLs.

Quote bind must be replay-safe. Complete KYC before calling:

```http
POST /api/v1/partner/quotes/583104729165083/bind
Authorization: Bearer <partner-token>
Idempotency-Key: bind-20260926-order-4182
Content-Type: application/json

{"payment_method":"mtn_momo","payer_phone":"+256772999888"}
```

`Idempotency-Key` is required and must be 1–128 characters. Keep and reuse the same key for retries of the same partner bind request. The key is scoped to the partner: an identical request returns the original `202` response and payment reference without creating another payment; reusing the key for a different quote, payment method or payer phone returns `409 Conflict`. If the first request is still being reserved/processed, retry the same request and key shortly. Supported methods are `mtn_momo`, `airtel_money` and `bank` (`cash_agent` is not supported through partner bind). A successful response contains `payment_ref` and `state`; read subsequent status with `GET /api/v1/partner/payments/{payment_ref}`.

### Outbound partner events

Set a callback URL in **Staff > Integrations** or `POST /api/v1/integrations/partners/{client_id}/webhook`. The API generates a new 256-bit webhook secret when a URL is saved; it is returned once. Saving a URL again rotates the secret. Production callbacks must use HTTPS and a publicly reachable host.

The callback receives JSON with this envelope:

```json
{
  "id": "evt_...",
  "event": "payment.confirmed",
  "created_at": "2026-09-26T12:00:00+00:00",
  "data": {"payment_ref":"PM-ABC123","quote_id":"583104729165083","policy_no":"PB-2026-ABC123"}
}
```

Headers include `X-PB-Event`, `X-PB-Delivery`, and `X-PB-Signature: sha256=<hex>`. Verify the HMAC-SHA256 digest against the exact raw request body using the webhook secret. A successful receiver should return any `2xx` response and deduplicate by `id`/`X-PB-Delivery`.

Current event names are `quote.created`, `payment.initiated`, `payment.confirmed`, `payment.failed`, `policy.issued`, `policy.status_changed`, `claim.created`, and `claim.status_changed`. Events are persisted before delivery, attempted up to three times with a short backoff, and visible in **Staff > Integrations**. Failed attempts can be manually retried there or through `POST /api/v1/integrations/webhooks/deliveries/{id}/retry`. Event data contains identifiers/status and policy/payment amounts; it does not include identity documents.

## Caddy and subdomain setup

`./install.sh` first starts the core services, checks API/portal/KYC, then interactively asks whether to build and start the optional Caddy container for `DOMAIN` on ports 80/443. Answer **yes** only on a dedicated front-door host after its DNS A record points to that VPS. Answer **no** if another Caddy already owns those ports. Non-interactive installs default to no; run `./install.sh caddy` explicitly when ready. Caddy routes `/` to the portal, `/api/*` and `/docs` to FastAPI, `/kyc/*` to the KYC web container on port 8080, and `/webhook` to the bot.
