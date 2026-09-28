# Protecta repair and deployment checklist

## What this repair covers

- Distinct stable WhatsApp variable/handler IDs; added missing route IDs.
- OTP issuance and verification backed by Twenty app KV, cryptographic six-digit
  codes, keyed hashes, ten-minute expiry, a resend cooldown, five attempt slots,
  and one successful session per challenge (atomic KV deletion).
- Partner provisioning, hashed API keys, token authentication, inactive-account
  rejection, effective scope checks, tenant-scoped delivery history and quote
  attribution. Staff provisioning and actions use `runAs: 'user'`, not the app's
  elevated record permissions.
- WhatsApp signature verification against raw bytes, queue-based inbound
  processing, persistent conversations and delivery retry receipts, using the
  existing tested bot state machine rather than nonexistent bot/session objects.
- Real worker definitions for queued WhatsApp notifications, signed partner
  deliveries, and policy email. No fabricated successes or authentication stubs.
- All eight referenced staff/settings/timeline components, including commission
  viewing and confirmation screens before staff operations.
- KYC intake mapping and response fields, support ticket reference display,
  person composite-name selection, and record mutation return data.
- Payment confirmation amount/expiry checks and retry recovery. Unique policy
  quote references and commission references prevent duplicate records at the
  database boundary. Existing data must be checked for duplicates before adding
  these constraints.
- A supported Node/React toolchain, offline build command, reference integrity
  checks, and first-boot timeout recovery without deleting data.

## Before applying to a workspace

1. Back up the workspace database and persistent storage if it contains data.
   A source-folder backup does NOT back up Docker volumes or database records.
2. Use Node 24.5+ (24.x). Run `npm ci` and `npm run check` in `protecta/app`.
3. Use an API key from the exact workspace you want to install into. On a shared
   VPS, use `npx --yes --package=node@24 -c 'bash ./start.sh'` to avoid replacing
   system Node. Follow the hidden key prompt in README if reauthentication is needed.
4. Apply with `protecta/start.sh`. Stop on any server-side migration error; do not
   reset Twenty to bypass a validation error.
5. Refresh that workspace. Check Quotes, Policies, Payments, Claims, Vehicles,
   Commissions, Partner accounts, KYC and Support tickets. Open Protecta Bode in
   settings. Assign the Protecta support role deliberately; do not grant it to
   every user automatically.

## Configuration

Configure server variables/secrets through the installed app's configuration,
not in source files. Application variables include pricing and `PUBLIC_BASE_URL`
(the externally reachable HTTPS origin, **not localhost**).

| Feature | Configuration |
| --- | --- |
| Customer OTP/session | `SESSION_JWT_SECRET`: independent random secret, at least 32 characters; working WhatsApp delivery |
| Partner tokens | `PARTNER_JWT_SECRET`: separate strong random secret |
| WhatsApp bot (preferred) | Settings → WhatsApp bot. Evolution API base URL, instance name and API key. The bot already onboarded on Evolution is connected there; official Meta Cloud API is optional. |
| WhatsApp outbound via Evolution env | `EVOLUTION_API_URL`, `EVOLUTION_INSTANCE`, `EVOLUTION_API_KEY` |
| Optional Meta Cloud API | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` |
| Meta webhook GET verification | `WHATSAPP_VERIFY`: value entered in the Meta webhook configuration |
| Meta webhook POST authentication | `WHATSAPP_APP_SECRET`: Meta app secret, not the verification token |
| Partner webhook delivery | `PARTNER_WEBHOOK_SECRET`, `PARTNER_WEBHOOK_ALLOWED_ORIGINS` (comma-separated exact HTTPS origins) and an active partner record's webhook URL |
| Payment callbacks | `PAYMENT_WEBHOOK_SECRET`; leave `REQUIRE_PAYMENT_SIGNATURE=true` |
| MTN | `MOMO_ENV`, `MOMO_SUBSCRIPTION_KEY`, `MOMO_API_USER`, `MOMO_API_KEY` |
| Airtel | `AIRTEL_ENV`, `AIRTEL_CLIENT_ID`, `AIRTEL_CLIENT_SECRET` |
| Policy email | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`; customer must have a primary email in Twenty |

Secrets for different purposes must differ. An unset provider remains
unconfigured; it does not simulate a payment or authenticate a customer.

## Document Generator app (`protecta/docgen`)

`start.sh` also syncs the standalone **Document Generator** app, which is
linked to Protecta through workspace events: when a policy is issued it
generates the policy certificate document (PDF and Word) from a template
(`{{placeholder}}` convention — see `docgen/README.md`). The original Word
policy wording is not in the repo yet; recreate it as a template body when
it arrives. Documents are served at `/s/docgen/documents/view?policyNo=...`
(PDF) and `/s/docgen/documents/docx?policyNo=...` (Word); the Protecta
policy page links to them automatically. To skip the app, delete
`protecta/docgen` or sync only `protecta/app` with the twenty CLI.

## Smoke-test in a disposable workspace / provider sandbox

- Open `/s/protecta/health` and check configuration flags. These flags report
  configured values only; they do not test provider connectivity.
- Create a quote for UGX 10,000,000. Verify the returned reference, UGX 150,000
  premium and record links in Twenty. This checks real GraphQL reads/writes,
  which mocks cannot validate.
- Create a support ticket; confirm the UI displays its ticket reference.
- Submit KYC and approve it as an authorized staff user. Verify the person's KYC
  status changes. Check that a user lacking write access cannot approve it.
- Request an OTP to a consented test number. Verify one correct code works only
  once, wrong codes lock out after five attempts, and failed delivery is not
  reported as success. Read the resulting policy list with the issued session.
- Open Settings → WhatsApp bot, paste the Evolution API URL, instance and key, then Save and connect. The webhook is `/s/protecta/whatsapp/webhook`. Send `menu`, `1` to calculate a premium (try 262500000) and `2` to onboard cover the same way as the website. Official Meta webhooks remain available if you set the Meta secrets instead.
- Configure Meta's webhook at `/s/protecta/whatsapp/webhook` only if you are not using Evolution; test GET verification,
  signed inbound POSTs, and rejection of unsigned/tampered POSTs. Send `menu`,
  create a quote, list policies, record a claim and create a support ticket.
  The bot directs payment to the existing payment page rather than guessing a
  portable phone number's network or silently debiting it.
- As authorized staff, POST `/s/protecta/api/partners` with name/type. Preserve the
  returned API key once; it has the form `clientId.secret`. Use `X-API-Key` for
  `/s/protecta/api/partners/me`, `/s/protecta/api/partners/events`, and attributed
  POST `/s/protecta/api/quotes`. Alternatively exchange `clientId`/`clientSecret`
  at `/s/protecta/api/partners/token` and use the returned Bearer token. Test an
  inactive account and missing scopes. Event history is the partner's outbound
  delivery log, not all workspace records.
- Use a sandbox payment and a **trusted, signed callback**. Verify policy issue,
  premium matching and replay recovery. Try a pending callback and a stale failed
  callback after confirmation: neither should reverse a confirmed payment.
- Test staff actions (claim advance, policy renewal quote, quote send, payment
  confirmation), activity rendering and commission viewing with realistic roles.
- Test partner delivery errors/retries, allowed-origin enforcement and policy
  email. Confirm queue jobs actually execute on the server.

## Important live-service limitations / release gates

These must be evaluated before real customer traffic. Passing unit tests and the
SDK build does not establish end-to-end provider compatibility or regulatory
readiness.

- The `twenty-app-dev` image and seeded credentials are for development. Restrict
  port 2020, use HTTPS, and plan a supported production deployment and backups.
- Enforce edge rate limits on OTP issuance/verification, partner token exchange,
  and public forms. KV has no compare-and-set for issuance, so its resend cooldown
  is best-effort under concurrent requests. Verification attempts and successful
  consumption use atomic deletes. Monitor and define retention for app KV data.
- The bot handles ordinary delivery retries, but multiple simultaneous messages
  from the same number and crashes between a domain write and receipt persistence
  still need load/recovery testing; this is not an exactly-once transaction across
  CRM and Meta. Queue job IDs deduplicate normal redelivery.
- Meta free-text messages require the relevant messaging window/opt-in. Approved
  templates are needed for business-initiated messaging outside that window;
  the current sender is free-text. Test onboarding/OTP delivery with your actual
  Meta setup before exposing it publicly.
- The payment callback expects a trusted service to authenticate/normalize provider
  results and sign them with the Protecta secret. Do not assume MTN/Airtel sends
  the app-specific HMAC, and do not disable signature verification to accept native
  callbacks. Confirm country/environment endpoints, currency, callback wiring and
  reconciliation against provider documentation/account settings before live use.
- Existing bank-account instructions and product language must be verified with
  the insurer. Provider failures leave a pending/manual-review payment, not a
  confirmed charge. There is no implied automatic charge retry.
- Review access to existing public reference-link pages and forms for your privacy
  requirements; staff routes and OTP-protected policy listing do not make every
  legacy page authenticated. Commission UI is capped at 100 displayed rows; use
  the workspace's record export for full statements.
- Quote/policy expiry scheduling, proactive renewal reminders, disaster recovery,
  provider reconciliation and retention require an operational plan. Manual
  renewal is implemented; unused legacy cron identifiers are not scheduled jobs.
