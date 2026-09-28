# Protecta SMS Sender

A standalone Twenty CRM app that sends **SMS** to customers through
[EgoSMS](https://www.egosms.co) when things happen in the workspace. It is
linked to the **Protecta Bode** app: whenever a quote, policy or claim is
created anywhere (bot, portal, partner API or the CRM), the matching
template is rendered and texted to the customer — in the right language.

Both apps install side by side into the same workspace (`start.sh` syncs
them together). The link works through shared workspace records and events —
Protecta owns the policies and quotes, this app owns the templates and the
SMS log.

## When SMS go out

| Event key | Trigger | Recipient | Template variables |
|---|---|---|---|
| `QUOTE_ISSUED` | `insuranceQuote.created` | `policyholderPhone` | `{{reference}}`, `{{premium}}`, `{{plate}}`, `{{validUntil}}`, `{{policyholderPhone}}`, `{{shareUrl}}` |
| `POLICY_ISSUED` | `insurancePolicy.created` | phone on the originating quote | `{{policyNo}}`, `{{quoteRef}}`, `{{premiumUgx}}`, `{{plate}}`, `{{periodStart}}`, `{{periodEnd}}` |
| `CLAIM_CREATED` | `insuranceClaim.created` | `reporterPhone` | `{{claimRef}}`, `{{policyNo}}`, `{{status}}`, `{{reporterPhone}}` |
| `RENEWAL_QUOTE`, `CUSTOM` | manual / API | as given | whatever the caller passes |

There are three ways a message goes out:

1. **Automatic** — the events above fire for records created from the bot,
   the portal, the partner API or the CRM.
2. **Manual (in the CRM)** — open **Sms messages → + New**, pick an event
   key and language, enter the recipient and variables (a JSON object),
   save. The reference, rendered message and delivery status fill
   themselves in.
3. **Manual (API)** — `POST /s/sms/send` with
   `{ "phone": "0772...", "eventKey": "POLICY_ISSUED", "language": "LG", "variables": { ... } }`.
   Either `eventKey` (template) or a raw `message` is required. This is how
   Protecta Bode triggers SMS from its own flows.

Every attempt is logged as an `Sms message` record with a `SMS-XXXXXX`
reference, the rendered text, provider code and delivery status
(`PENDING`/`SENT`/`FAILED`). Identical sends of the same message to the
same recipient are suppressed: when several triggers ask for one
notification (e.g. the policy event handler and Protecta's policy-issued
job), the first send wins and the customer is never double-texted.

## Templates and languages

Templates live in the **Sms templates** object: one row per **event key +
language** (English `EN`, Luganda `LG`, Swahili `SW`, Runyankole `RUN` out
of the box). Placeholders use `{{name}}` and are replaced at send time from
the event's variables. Event keys and languages are Twenty SELECT values, so
they are stored as `UPPER_SNAKE_CASE`; the send API still accepts lowercase.

Language choice: the caller's `language` first, then the configured default
(`SMS_DEFAULT_LANGUAGE`, normally `EN`), then any template for the event.
**No template means no send** — an SMS costs money, so nothing is guessed
or invented.

## Configuration

Set these on the SMS Sender app's settings — never in source code:

| Variable | Purpose |
|---|---|
| `EGOSMS_USERNAME` | EgoSMS account username |
| `EGOSMS_PASSWORD` | EgoSMS account password (**secret**) |
| `EGOSMS_SENDER_ID` | Sender id shown to the customer (default `Upsyd`) |
| `SMS_DEFAULT_LANGUAGE` | Template fallback language (default `EN`) |

Until `EGOSMS_USERNAME` and `EGOSMS_PASSWORD` are set the app is inert:
events resolve and log nothing, and the API answers
`422 { "ok": false, "error": "SMS provider is not configured." }`.

## Install

`protecta/start.sh` syncs this app together with Protecta and the Document
Generator. On its own: `cd protecta/sms/app && npm install --legacy-peer-deps && npx twenty apply .`
Tests: `npm test`. Build: `npm run build`.
