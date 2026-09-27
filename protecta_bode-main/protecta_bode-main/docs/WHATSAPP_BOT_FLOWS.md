# Protecta Bode - WhatsApp Bot: In-Chat Functions & Backend Recording

**Principle:** every action a user takes in WhatsApp **writes a real record through the same backend API the portal uses** - never a "bot-only" side channel. That way whatever a customer, agent or broker does in chat shows up instantly in their portal dashboards, the admin console, and reports. (Pattern proven in the AgriLink bot: LangGraph flows -> internal API -> Postgres.)

```
WhatsApp <-> Business Cloud API <-> bot (LangGraph) <-> Protecta API (FastAPI) <-> Postgres
                                      │                       └─ email service (receipts, policy PDFs)
                                      └─ same JWT/service-token auth as the portal
```

**Identity = phone number.** The bot looks up the WhatsApp number in `users` (customer, agent or broker - roles get role-aware menus). Unregistered numbers get a "create account" flow that writes a real `users` row (pending KYC). A signed service token (`INTERNAL_API_KEY`) authenticates bot->API calls; every call is audit-logged with `channel=whatsapp`.

---

## 1. What users can DO in chat (and what it writes)

| # | In-chat function | Menu (customer) | Backend writes | Visible afterwards in |
|---|---|---|---|---|
| 1 | **Buy cover** | `1` | `quotes` (channel=`whatsapp`) -> on payment: `payments` + `policies` + policy PDF/certificate queued | Customer portal (policies), agent book (if agent-attributed), admin issuance queue, reports |
| 2 | **Renew** | `2` | `renewals` + `quotes` (linked to old policy) -> `payments` + new `policies` | Both policy records linked; retention report |
| 3 | **My policy** | `3` | read-only + `conversations` log; sends PDF links (documents table) | - |
| 4 | **File a claim** | `4` | `claims` (FNOL: what/when/where + photos saved to documents store, status=`reported`) | Customer portal claims tracker, admin claims console, broker client view |
| 5 | **Payment link / pay bill** | `5` | `payments` (initiated) -> provider webhook confirms | Customer portal payment history, reconciliation queue |
| 6 | **Talk to support** | `6` | `support_tickets` + `ticket_messages` | Helpdesk queue, customer portal ticket view |
| 7 | **Update my details** | `7` | `users` (email/town) via verified-change flow (OTP to old contact) | Admin user record + audit log |
| 8 | **My commissions** (agents/brokers) | `8` | read-only from `commissions` | Agent portal commissions page - same numbers |
| 9 | **Quote for a customer** (agents/brokers) | `9` | `quotes` with `created_by=<agent>`, `channel=whatsapp-agent`; share link sent to the customer | Agent pipeline (new -> quoted -> paid), attribution reports |
| 10 | **Become an agent** | `10` | `partner_applications` (KYC + licence capture starts) | Admin distribution queue |

Numbered menus only (feature-phone friendly), `MENU` keyword anytime, and a bold `*Protecta Bode*` heading on every outbound message (see §3). **Bot copy is plain text - no emojis** (house rule, plan §7): emphasis uses WhatsApp `*bold*` and clear wording only. Full message-by-message dialogues per flow: see §3 samples + AgriLink `bot/app/graph.py` for the engine pattern to port.

## 2. Session & state

- Bot state machine (LangGraph state): `phone -> intent -> flow -> step`, TTL 15 min, resumed by `MENU`.
- Every inbound/outbound message stored in `conversations`/`messages` (already in the inherited schema) -> full chat history per user in the admin console; support agents can see the thread when a ticket escalates.
- Photos (claims): Cloud API media downloaded by the bot, stored in the documents store, referenced from `claims.documents[]`. Never stored inside the DB itself.

## 3. Message formatting standard (every outbound message)

Every message the bot sends opens with a **bold heading line** - WhatsApp `*bold*` markup, no emojis (house rule):

```
*Protecta Bode*

<body - question, options, confirmation>
```

- Implemented once in the bot engine as a `brand()` wrapper applied to every outbound payload (same pattern as AgriLink's `BRAND` constant) - flows never hand-write the heading, so it cannot be forgotten.
- Flow-specific context goes on the first body line in bold where useful, e.g. `*Your quote*`, `*Payment received*`, `*Claim update*` - the brand heading stays identical everywhere.
- Cost is ~16 characters per message; well inside the 4096-character Cloud API message limit.

## 4. Sample dialogue - buy cover (recorded end-to-end)

```
User:    Hi
Bot:     *Protecta Bode*
         Welcome! Cover your ride, cover your life.
         1 Buy cover  2 Renew  3 My policy  4 Claim  5 Pay a bill
         6 Talk to support  7 My details
         Reply with a number or type MENU.
User:    1
Bot:     *Protecta Bode*
         *Buy cover*
         What's your car's value in UGX? (e.g. 25,000,000)
User:    25m
Bot:     *Protecta Bode*
         *Your quote*
         UGX 375,000/year (1.5% of UGX 25,000,000)
         Covers: car body • third party • driver.  [Quote 583104729165083]
         1 Pay now  2 Share to my number  3 Send me the link
User:    1
Bot:     *Protecta Bode*
         *Pay now*
         1 MTN MoMo  2 Airtel Money  3 Bank
User:    1
Bot:     *Protecta Bode*
         Approve the MoMo prompt on 0772***456 now.
         …
Bot:     *Protecta Bode*
         *Payment received*
         UGX 375,000. Policy *PB-2026-018421* is ACTIVE.
         Policy schedule + motor certificate: [PDF] [PDF]
         (backend: quotes->converted, payments->confirmed, policies->active,
          commission accrued if agent-attributed, receipt + policy emails sent)
```

## 4. Agent/broker attribution rule (important)

A quote created in chat is attributed to the **account whose number is chatting**. For agent-assisted sales the agent uses function 9 (quote for a customer) with the customer's number - the customer then pays from their own WhatsApp or the shared link; `quotes.created_by` keeps the agent credit. This keeps commissions honest and is exactly what the agent-performance reports (see `docs/REPORTS.md`) slice on.

## 5. Transport note (unchanged from plan)

Business flows above are transport-agnostic. Target transport is the **official WhatsApp Business Cloud API** (regulated-insurer requirement); the AgriLink Evolution-API adapter can be kept for internal/testing channels only.
