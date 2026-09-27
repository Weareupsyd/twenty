# Protecta Bode - Web Platform Enhancement Plan

**Product:** Protecta Bode (motor cover @ 1.5% of vehicle value) by Liberty General Insurance Uganda
**Date:** 25 Sep 2026 · **Status:** Draft for review
**Goal:** Turn the single-page quote-and-buy site into a full insurance platform for **Customers, Agents, Brokers and Admin** - reusing the proven AgriLink Uganda stack (KYC, email service, WhatsApp bot, FastAPI backend, React portal), tailored for a **Uganda general insurance** business.

---

## 1. Where we are today

**What exists (this repo):**

| Asset | What it is | Gap |
|---|---|---|
| `Protecta bode/protectabode-landing.html` | Beautiful single-file landing + premium calculator + 4-step buy flow (vehicle -> details -> pay -> done), MTN MoMo / Airtel Money / Stanbic options, WhatsApp/email share, print policy summary | No backend - quotes, customers and "payments" die in the browser. No login, no policy record, no documents |
| `assets/key-visual-*`, brand SVGs, MTN/Airtel/Stanbic logos | Brand system: navy `#0B1C48`, orange `#CA6E2B`, sky `#DDF1F6`, Poppins/Noto Sans | Reuse as the design language for every portal |
| `all-vehicles-model.json` | Make/model data for the calculator | Reuse as-is in the portal |
| `AgriLink_Uganda-main.zip` | Our previous production app - see §2 | The engine we will transplant |

---

## 2. What we inherit from AgriLink (capability mapping)

AgriLink is a deployed, Dockerised, multi-role platform. Almost every piece maps 1:1 onto an insurance platform:

| AgriLink component | What it does today | Becomes in Protecta Bode |
|---|---|---|
| `backend/` - FastAPI + Postgres + Redis, JWT auth, role-based access (`UserRole`), admin API, payments/payments API, reports, audit log, notifications, push, PDF service, OTP/SMS, settings store | Marketplace API | **Protecta Insurance API** - quotes, policies, payments, claims, commissions, users, reports. Same skeleton, insurance domain models |
| `frontend/` - React 18 + Vite PWA, role-scoped portal, QR codes, installable, dark UI | Buyer/farmer/transporter/admin portal | **Protecta Portal** - one React app with 4 role areas: Customer, Agent, Broker, Admin (re-skinned to Protecta brand: light + navy/orange) |
| `bot/` - LangGraph WhatsApp assistant on Evolution API; keyword + numbered-menu flows, feature-phone friendly, writes real records via internal API | Sell/serve marketplace users on WhatsApp | **Bode WhatsApp assistant** - buy cover, renew, policy status, claim reporting, talk-to-human, agent onboarding. Graph logic reused; flows rewritten for insurance |
| `email_service/` - standalone mail microservice + HTML template pack (otp, welcome, quote, receipt, invoice, password-reset, support-escalation, commission…) | Transactional email | **Policy comms** - welcome, quote, policy-issued (+ PDF), payment receipt, renewal reminders, claim updates, commission statements. New Protecta-branded templates, same service |
| `kyc-stack/` - Kabila (MIT, self-hosted): ID document OCR, MRZ/barcode parsing, cross-validation, liveness detection, face match; portal talks to it via API key; the portal never touches ID images | Farmer/buyer identity verification | **Insurance KYC/AML** - verify customers (NIN/passport) at purchase, and verify **agents & brokers** (ID + licence) at onboarding. Same handoff-session pattern (QR / phone link) |
| `docker-compose.yml` + `caddy/` + `start.sh` | One-command full-stack deploy with automatic HTTPS | Same topology, renamed services - see §6 |
| `docs/`, runbooks (Postgres SHM, KYC troubleshooting), Postman collections (Evolution API, EgoSMS) | Ops knowledge | Carry over; add insurance runbooks |

**Deliberately left behind:** marketplace concepts (products/listings/orders/transport/reviews/cooperatives). The Wallet concept survives as a future *agent premium/commission wallet*.

---

## 3. The product we're building

> **Protecta Bode Platform** - a motor-first (then general) insurance platform where a customer buys cover in under 3 minutes on web or WhatsApp, an agent or broker sells and tracks commissions, and Liberty operations underwrite, reconcile payments, handle claims and report to the IRA from one console.

Design principles:

1. **Reuse before rebuild** - every AgriLink service gets renamed and re-domain-ed, not rewritten.
2. **Motor first** - Protecta Bode (car body + third party + driver @ 1.5%) is the only product at launch; the model keeps a `product` table so home/travel/PA follow the same rails.
3. **Channels share one brain** - web, WhatsApp, agent and broker all call the same quote/policy API, so a quote started anywhere finishes anywhere.
4. **Compliance by design** - KYC tiers, audit trail on every action, IRA-friendly reports, Uganda Data Protection & Privacy Act (2019) consent captured at sign-up. *(Final regulatory wording to be confirmed with Liberty compliance.)*

---

## 4. Domain model (insurance-flavoured rewrite of AgriLink `models.py`)

```
User            role: customer | agent | broker | admin | underwriter | claims_handler
                kyc_status, kyc_tier, phone(unique), email, nin, license_no (agents/brokers),
                principal_broker_id (sub-brokers), status
Vehicle         owner_id, plate (unique), make, model, year, sum_insured, body_type
Quote           vehicle_id, product_code, rate_snapshot (1.5%), extras (JSON), premium,
                channel: web | whatsapp | agent | broker, created_by (agent/broker),
                status: draft | shared | converted | expired, expires_at
Policy          quote_id, policyholder_id, vehicle_id, period_start/end, certificate_no,
                status: pending_payment | active | lapsed | cancelled | expired
Payment         policy_id, provider: mtn_momo | airtel_money | bank | cash_via_agent,
                provider_ref, amount, status: initiated | pending | confirmed | failed,
                reconciled_by/at  <- feeds the admin reconciliation queue
Endorsement     policy_id, type (plate fix, value update, …), payload JSON, approved_by
Claim           policy_id, FNOL data, incident photos, status: reported | assigned | assessed |
                approved | rejected | settled, adjuster_id, reserve, payouts
Renewal         policy_id, generated_at, notices_sent (30/14/3/0 days), status
Commission      beneficiary (agent|broker), policy_id, basis, rate, amount,
                status: accrued | payable | paid, statement_id
Document        policy PDF, motor certificate, receipts, commission statements (PDF service)
AppSetting      product rates, extras, min/max vehicle value, T&C version  <- editable in Admin, no redeploy
AuditLog, Notification, PushSubscription, Conversation/Message, SupportTicket   <- all reused as-is
```

---

## 5. The four portals

One React PWA (AgriLink shell), four role-scoped areas, Protecta brand (light surfaces, navy sidebar, orange CTAs, HugeIcons throughout - §7).

### 5.1 Customer portal `/app`
- **Dashboard:** my cars -> active cover cards with expiry countdown; "Renew" in 2 taps.
- **Buy cover:** the current landing flow, authenticated (value -> quote -> details -> pay -> policy issued).
- **KYC:** "Verify your identity" (Kabila QR / phone link) - unlocks purchase.
- **Policies & documents:** policy wording, motor certificate, receipts - download/email.
- **Claims:** report an incident (what happened, when/where, photos) -> track status like a delivery.
- **Payments:** history, retry failed MoMo/Airtel payments.
- **Support:** WhatsApp deep-link into the bot with context, or raise a ticket.

### 5.2 Agent portal `/agent`
For licensed individuals who sell Protecta Bode to customers.
- **Leads pipeline:** new -> quoted -> paid -> issued; quote-on-behalf (same calculator + customer capture, marks the agent as source).
- **Share & close:** send quote link / WhatsApp message to the customer; customer pays themselves - agent gets credit automatically.
- **Commissions:** per-policy accrued/payable/paid, monthly statement PDF (email template already exists in AgriLink: `commission.html` / `commission-invoice.html`).
- **Book of business:** clients, expiry report (who to call this month).
- **My status:** KYC + IRA agent licence verified badge, targets vs actual.

### 5.3 Broker portal `/broker`
Everything an agent has, plus brokerage-scale tools:
- **Corporate clients & fleets:** multi-vehicle quotes (CSV bulk upload -> quote pack), fleet renewal calendar.
- **Sub-brokers:** onboard/track their producers and override rates.
- **Statements:** monthly commission statement per brokerage + per client account.
- **Client cover report:** all clients, all policies, lapsing soon - exportable.

### 5.4 Admin console `/admin`
- **Issuance queue:** pending payments -> confirm bank transfers / failed-prompt retries -> issue policy + certificate.
- **Payment reconciliation:** MoMo/Airtel callbacks vs policy records; mismatch view; manual match.
- **Distribution management:** onboard/approve/suspend agents & brokers, set commission rates, verify licences.
- **Claims console:** assign adjuster, move status machine, attach assessments, trigger payment.
- **Product config:** rate %, extras, value bands, T&C version - no redeploy (`AppSetting`).
- **Reports:** premiums by channel/agent/broker/day, conversion funnel, lapse rate, claims ratio; **IRA returns pack** (format per compliance).
- **Audit log viewer + support impersonation** (every action logged).

---

## 6. Target architecture

Same topology AgriLink runs in production today - renamed, insurance models:

```
                          Caddy (auto-HTTPS)
   protectabode.ug ──►  ├── /            -> portal (React PWA via nginx)
                         ├── /api/v1     -> api (FastAPI)  ── Postgres + Redis
                         ├── /kyc        -> kyc-web (Kabila hosted verify app)
                         │                    └── kyc-api + kyc engine + its Postgres
                         ├── /api/v1/chatbot/webhook -> bot (LangGraph) -> Evolution API <-> WhatsApp
                         └── (internal)  -> email service (SMTP) -> customer inbox
   Landing page = static, served by the portal container as the public face at /
```

- `start.sh` pattern kept: one command builds and starts everything, prints admin credentials, `logs/status/down` verbs.
- Landing page stays exactly what it is (it converts well) - it gains a real API behind the pay button and "Sign in / My policies" entry points.
- Swagger at `/docs` for the integrators (brokers may build on it later).

---

## 7. Icon system - HugeIcons (hugeicons.com) as the single standard

All icons across the landing page and the four portals use **HugeIcons**, Stroke Rounded style only:

**Static pages (landing, marketing, emails):** free Icon Font via CDN -
```html
<link rel="stylesheet" href="https://use.hugeicons.com/font/icons.css" />
<i class="hgi-stroke hgi-insurance"></i>
```
6,000+ free stroke-rounded icons, no attribution required, WOFF2/TTF/SVG formats.

**React portal:** `@hugeicons/react` + `@hugeicons/core-free-icons` (tree-shakable, same style). Pro (60,000+ icons, 10 styles) is an upgrade path if dashboards ever need duotone/solid - do **not** mix styles before then.

**House rules**
1. One style everywhere: Stroke Rounded. Size via `font-size` (16/20/24). Colour inherits `currentColor` (navy/orange tokens).
2. Brand logos (Liberty, Protecta Bode, MTN, Airtel, Stanbic, WhatsApp glyph on share buttons) stay as the supplied SVG/JPG assets - HugeIcons never replaces a brand mark.
3. Icon names must be visually verified in the browser before shipping (the free-set class list lives at `use.hugeicons.com/font/icons.css`); candidates: `insurance`/`shield-*` for cover, `steering-wheel`/`car-*` for vehicle, `accident` for claims, `wallet-01`/`coin` for commissions, `user-multiple` for roles, `pencil-edit-01` for edit, `arrow-right-01` for CTAs.
4. Landing page migration: swap the four bespoke inline SVG symbols for HugeIcons equivalents as a Phase 0 clean-up (tiny, zero-risk, done in the browser where rendering is visible).
5. **No emojis and no em/en dashes anywhere in product copy** - not in the web UI, emails, WhatsApp bot messages, documents or code comments. Icons come from HugeIcons; emphasis comes from typography; dashes are plain ASCII hyphens (-). (Applies to all channels and all languages.)

---

## 8. Channel details

### 8.1 Email (reuse `email_service`, new templates)
| Trigger | Template (new, Protecta-branded) |
|---|---|
| Sign-up / phone verify | `otp.html` (reuse) |
| Quote saved/shared | `quote.html` -> Protecta quote summary + pay link |
| Payment confirmed | `receipt.html` + `policy-issued.html` with **policy PDF + motor certificate attached** (PDF service reused) |
| Renewal window | `renewal-reminder.html` at 30 / 14 / 3 / 0 days before expiry |
| Claim journey | `claim-acknowledged.html`, `claim-update.html` |
| Agent/broker month-end | `commission-statement.html` |
| Account | `welcome.html`, `password-reset.html` (reuse) |

### 8.2 WhatsApp bot (reuse LangGraph engine; revisit transport)
**Full in-chat function spec: `docs/WHATSAPP_BOT_FLOWS.md`.** The bot performs real functions in WhatsApp - buy cover, renew, policy documents, claim FNOL with photos, pay bills, support tickets, agent quoting - and **every action writes through the same backend API the portal uses** (quotes -> payments -> policies -> claims -> tickets -> commissions), so customers, agents, brokers and admin all see chat activity in their portals and reports. Identity = WhatsApp number; every call audit-logged with `channel=whatsapp`.
Numbered-menu flows (feature-phone friendly), all writing real records:
```
1 Buy cover        -> car value -> live quote -> pay (MoMo/Airtel prompt or payment link)
2 Renew            -> lookup by plate/phone -> pay
3 My policy        -> status, expiry, documents (PDF links)
4 Claim            -> guided FNOL (what/when/where -> photos -> reference no.)
5 Talk to support  -> ticket + handoff to a human (office hours)
6 Become an agent  -> KYC + licence capture -> admin approval queue
```
**Decision flag:** AgriLink's transport is Evolution API (an *unofficial* WhatsApp gateway). For a regulated insurer, customer-facing WhatsApp should move to the **official WhatsApp Business Cloud API** (or WhatsApp Business via a BSP). The bot graph is transport-agnostic - swap the adapter, keep the flows. Business number + WABA verification needs to be owned by Liberty.

### 8.3 KYC (reuse Kabila end-to-end)
- **Tier 0** - browsing/quoting: no KYC.
- **Tier 1** - buying cover: NIN or passport + liveness + face match, automated (Kabila handoff session via QR or phone link; the portal never handles ID images).
- **Tier 2** - high-value vehicles / corporate fleets / agents & brokers: automated check **+ admin manual review**; agents/brokers additionally capture IRA licence details.
- PII minimisation, retention rules, consent line at capture (DPPA 2019); data stays on our VPS. Exact thresholds and any IRA reporting of KYC to be confirmed with compliance.

### 8.4 Payments
- **Phase 2 launch:** MTN MoMo + Airtel Money via an aggregator (faster: one integration, one settlement report) *or* direct MoMo Collections + Airtel APIs (cheaper per txn, more work). Decision in §10.
- Bank (Stanbic) transfer: virtual reference per policy + admin reconciliation screen (AgriLink's reconcile flow reused).
- Policy issues **only** on confirmed payment; webhook-driven state machine; auto-receipt + auto-issuance.

### 8.5 Partner & Broker API - **spec: `docs/PARTNER_API.md`**
Key-based (client-credentials) REST API at `/api/v1/partner` so external brokers and partners plug their own systems in: create customers, open KYC sessions, quote (single + bulk fleet), bind, collect payments with signed webhooks (`payment.confirmed`, `policy.issued`, …), file claims, and pull their own book's reports. Sandbox + live keys, scopes, idempotency keys, RFC-7807 errors, rate limits, certification runbook. Partners see only their own book - never portfolio data.

### 8.6 Reports suite - **spec: `docs/REPORTS.md`**
Monthly **agent commission statements** (PDF + email, accrual -> payable -> paid -> clawback ledger), **agent performance** (activity, conversion, GWP, retention, time-to-close, claims ratio, leaderboard), and the **agents-brokers distribution tree** (who pushes the product for whom, attribution mix by channel, broker scorecards, orphan watch) - plus the ops pack (daily flash, reconciliation, renewals, claims aging, funnel, partner-API usage, IRA quarterly pack). All channel-attributed (web / WhatsApp / agent / broker / partner API) and reconciled to confirmed payments only.

---

## 9. Roadmap

| Phase | Weeks | Deliverable | Acceptance |
|---|---|---|---|
| **0 - Polish** | now | Heading weights done; HugeIcons swap on landing; "Sign in" stub; deploy static landing | Live landing unchanged visually except lighter headings |
| **1 - Foundation** | 1-3 | Fork backend -> Insurance API: auth (4 roles), vehicles, quotes, policies, PDF policy + certificate; Admin v1 (issue, users, audit); landing posts to API | A quote on the landing page creates a real quote/policy in Postgres; admin can see it |
| **2 - Money & docs** | 3-5 | MoMo + Airtel live; reconcile screen; email service live (welcome/quote/receipt/policy) | Customer pays with MoMo -> policy + certificate land in their inbox automatically |
| **3 - WhatsApp** | 5-7 | Transport decision + Bode bot flows (buy/renew/status/claim/human) | A customer buys cover entirely inside WhatsApp |
| **4 - KYC** | 7-8 | Kabila live; tier gates on purchase; agent/broker licensing + admin review queue | Purchase blocked without Tier-1 pass; agent activation requires licence + KYC |
| **5 - Agent & Broker portals** | 8-11 | Commissions engine + statements; leads & quote-on-behalf; fleet/CSV quoting; sub-brokers | Agent sees a commission statement; broker quotes a 20-vehicle fleet from CSV |
| **6 - Claims & renewals** | 11-14 | FNOL on web + WhatsApp; claims console; renewal automation (30/14/3/0 notices); IRA reports pack | Claim reported on WhatsApp is visible in the claims console; a renewal notice fires 30 days out |
| **7 - Harden** | 14+ | Pen-test, backups/DR drill, monitoring, load test, staff training, staging->prod cutover | Go-live sign-off |

---

## 10. Open decisions (need Liberty/business input)

1. **Mobile money:** direct MTN/Airtel APIs vs aggregator (Flutterwave / Relworx / Yo! …) - settlement account, fees, who has the Liberty paybill/merchant codes?
2. **WhatsApp transport:** official Cloud API/BSP (recommended for a regulated insurer) vs Evolution API (fast, already built). Owner: compliance.
3. **Commission scheme:** agent vs broker rates, accrual->payable rules, clawback on cancellation.
4. **KYC thresholds:** vehicle value above which Tier 2/manual review applies; corporate onboarding requirements.
5. **Claims scope:** in-house adjusters vs partner garages; what Phase 6 must cover (estimate approvals? settlement payments?).
6. **Domains & senders:** ~~portal domain~~ decided: **`protectabode.weareupsyd.com`** (+ short alias `bode.weareupsyd.com` for WhatsApp/SMS links); WhatsApp Business number, from-address for email (e.g. `policies@liberty…`), SPF/DKIM still to confirm.
7. **Portal theme:** recommend light with navy/orange brand (matches the poster); AgriLink's dark shell is a reskin, not a rebuild.

---

## 11. Non-functional requirements

- **Security:** JWT + role claims, per-portal route guards, secrets in `.env` only, admin credential bootstrap like AgriLink's `start.sh admin`, audit log on every privileged action, rate limiting on quote/OTP endpoints.
- **Data protection:** DPPA 2019 - consent capture, purpose limitation, retention policy, PDPO registration; KYC images never enter our DB (Kabila holds them).
- **Reliability:** nightly Postgres dumps + offsite copy, healthchecks (fix the `pg_isready` caveat AgriLink's runbook documents), Redis persistence, Caddy TLS auto-renew.
- **Environments:** staging + prod compose projects on the VPS; `APP_ENV` gate on payment/KYC sandboxes.
- **Observability:** compose logs + Uptime monitor + weekly premium/reconciliation digest email to ops.

---

## 12. Immediate next actions

- [x] ~~Approve/adjust this plan (esp. §10 decisions 1-2)~~ - in progress
- [x] Phase 0: heading weights; favicon set built from the steering-wheel mark (`favicon.ico` + Apple touch + PWA icons); HugeIcons standard (§7); brochure linked; **email pack built (21 templates incl. invoice)**
- [x] Specs written: WhatsApp in-chat functions (`docs/WHATSAPP_BOT_FLOWS.md`), Partner & Broker API (`docs/PARTNER_API.md`), Reports suite (`docs/REPORTS.md`)
- [x] ~~Scaffold `platform/` in this repo from the AgriLink tree (rename services, strip marketplace models, stand up compose with insurance API skeleton)~~ **done:** `platform/` = FastAPI insurance backend (auth/quotes/payments/policies/claims/KYC/**partner API**/**reports**, 5/5 smoke tests green) + vendored KYC stack re-skinned in Protecta Bode colours with the logo + WhatsApp bot (brand() heading wrapper) + email microservice serving the 21-template pack (REPEAT blocks live) + docker compose. AgriLink zip deleted
- [ ] Port the email pack into the `email_service` (wire `{{tag}}` replacement, `REPEAT:` blocks + PDF attachments)
- [ ] Confirm aggregator/payment rails + WhatsApp Business route with Liberty
