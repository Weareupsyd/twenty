# Protecta Bode Partner API v1

This document describes the partner endpoints currently implemented by the API. The service base URL is `https://<DOMAIN>/api/v1` (or `http://<VPS-IP>:18000/api/v1` for a local installation). OpenAPI/Swagger is served at `/docs`.

## Credentials and access

An administrator creates a partner in **Staff > Integrations** or with `POST /integrations/partners`. The API returns a `client_id` and `client_secret` once; store the secret server-side. Partner accounts use a 15-minute client-credentials bearer token:

```http
POST /partner/auth/token
Content-Type: application/json

{"client_id":"pb_...","client_secret":"..."}
```

```json
{"access_token":"...","token_type":"bearer","expires_in":900}
```

Send `Authorization: Bearer <access_token>` on `/partner/*` requests. There is no refresh token; request another token when this one expires. Inactive partner credentials are rejected.

Partner records and quotes are isolated by partner ID. Customers created by a partner are linked to it; that partner can only read those customers, quote for them, initiate binds on its own quotes, read payments for its quotes, and file claims on its policies. Unknown or unlinked customer IDs return 404.

## Customers

### Create a customer

```http
POST /partner/customers
Content-Type: application/json

{
  "full_name": "Amina Nansubuga",
  "phone": "+256772123456",
  "email": "amina@example.com",
  "nin_or_passport": "..."
}
```

`email` and `nin_or_passport` are optional. Success is `201` with `customer_id` and `kyc_status`. A duplicate phone returns `409`.

### Read a customer

```http
GET /partner/customers/{customer_id}
```

Returns the partner-linked customer's name, KYC status and its policy number/status summary.

## Quotes and payment bind

### Create a quote

```http
POST /partner/quotes
Content-Type: application/json

{
  "customer_id": 123,
  "vehicle": {
    "plate": "UAA 123A",
    "make": "Toyota",
    "model": "Premio",
    "year": 2018,
    "value": 25000000
  },
  "product_code": "BODE-01"
}
```

The customer must be linked to the calling partner. Success is `201` with a random 15-digit numeric `quote_id`, premium in UGX, rate, expiry and a hosted `share_url`. The quote is attributed to the partner for data access and event delivery.

### Bind a quote / start payment

```http
POST /partner/quotes/{quote_id}/bind
Authorization: Bearer <access_token>
Idempotency-Key: <unique-key-up-to-128-characters>
Content-Type: application/json

{"payment_method":"mtn_momo","payer_phone":"+256772123456"}
```

`payment_method` is `mtn_momo`, `airtel_money` or `bank`; `payer_phone` is optional. The quote must belong to the partner and its customer must have approved KYC. Success is `202` with `payment_ref` and `state`.

The key is scoped to the partner. Repeating the same request with the same key returns the original response without creating another payment or event. Reusing a key with a different operation or request returns `409`; use a fresh key for a new bind. A quote already converted or expired returns a business-rule `422` response.

### Read payment status

```http
GET /partner/payments/{payment_ref}
```

A payment reference is visible only to the partner that owns its quote. The response contains `payment_ref`, `status` and `amount`.

## Claims and commissions

### File a claim

```http
POST /partner/claims
Content-Type: application/json

{
  "policy_no": "PB-2026-ABC123",
  "incident_date": "2026-09-26",
  "description": "Describe what happened in at least twenty characters.",
  "location": "Kampala",
  "photos": []
}
```

The policy must belong to a quote created by this partner. The successful response contains the claim `reference` and `status`.

### Commission summary

```http
GET /partner/reports/commissions?month=2026-09
```

`month` uses `YYYY-MM`. The summary is restricted to commissions attached to policies for the calling partner's quotes and contains the month, commission-row count (`policies`) and total UGX commission.

## Signed outbound event callbacks

Configure the partner callback in **Staff > Integrations** or `POST /integrations/partners/{client_id}/webhook`. Saving a URL creates a new random signing secret; the secret is displayed once. Saving again rotates it. Production callbacks require an HTTPS URL with a public DNS address.

Protecta Bode persists the event before delivery and sends a JSON envelope similar to:

```json
{
  "id": "evt_...",
  "event": "payment.confirmed",
  "created_at": "2026-09-26T12:00:00+00:00",
  "data": {
    "payment_ref": "PM-ABC123",
    "quote_id": "583104729165083",
    "policy_no": "PB-2026-ABC123",
    "amount_ugx": 375000
  }
}
```

Headers are `X-PB-Event`, `X-PB-Delivery`, and `X-PB-Signature: sha256=<lowercase-hex-digest>`. The signature is HMAC-SHA256 over the exact UTF-8 request body using the webhook signing secret. Verify the raw body before parsing, return any `2xx` on success, and deduplicate by the envelope `id` or `X-PB-Delivery`.

Events currently emitted for partner-originated activity are `quote.created`, `payment.initiated`, `payment.confirmed`, `payment.failed`, `policy.issued`, `policy.status_changed`, `claim.created`, and `claim.status_changed`. Payment/policy event delivery is idempotent for repeated provider confirmation callbacks. Delivery is attempted up to three times with a short backoff; administrators can inspect failed events in the Integrations page and queue a retry. Failed deliveries can also be retried with `POST /integrations/webhooks/deliveries/{delivery_row_id}/retry`.

The inbound payment-provider callback is a separate flow: providers call `/payments/webhook/{provider}` and sign the exact request body using `PAYMENT_WEBHOOK_SECRET`. See [`platform/docs/ACCESS_AND_WEBHOOKS.md`](../platform/docs/ACCESS_AND_WEBHOOKS.md) for that callback, WhatsApp routing, email OTP onboarding and installation details.
