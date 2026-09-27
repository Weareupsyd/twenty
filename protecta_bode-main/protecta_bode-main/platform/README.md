# Protecta Bode Platform

The full-stack insurance platform behind the Protecta Bode landing page: quotes, policies,
payments (MTN MoMo / Airtel Money / bank), claims, commissions, a Partner & Broker API,
a WhatsApp bot, branded transactional email, and the vendored KYC (identity verification)
stack - re-skinned in Protecta Bode colours with the Protecta Bode logo.

Underwritten by Liberty General Insurance Uganda. Product: motor cover at 1.5% of vehicle
value (car body + third party + driver).

## Layout

| Path | What it is |
|---|---|
| `backend/` | FastAPI insurance API (`/api/v1`): username/password auth with OTP account setup, quotes, payments, policies, claims, KYC handoff, **policy document generator** (the official wording as a password-protected PDF with the schedule filled), **Partner API** (`/api/v1/partner`), **reports** (agent commissions, performance, broker tree, daily flash). Smoke tests included |
| `frontend/` | **Protecta Bode portal** - React 18 + Vite PWA. The signed-out `/` route recreates the [supplied original campaign landing page](https://github.com/iamtutumo/protecta_bode/blob/main/protectabode-landing.html) with its key visual and premium calculator; quote and payment steps call the live APIs. Portal areas use the shared design-guide shell in Protecta navy/orange: outlined actions, hairline rules and open data layouts. Role-scoped areas: customer (cover, claims, KYC, quotes), agent (book + commissions), broker (agent performance + distribution), admin (daily flash, payment reconciliation, claims console, distribution tree). Public quote creation is signed-out; a customer account is required to attach a public quote before checkout so policy issuance stays linked to the policyholder. Partner-created quotes are already customer-linked and can be paid from the share URL |
| `kyc/` | Vendored, self-hosted identity verification stack (MIT) - **rebranded**: supplied Protecta Bode wordmark, navy/orange theme (umbrella is favicon-only) (`frontend/src/protecta/ProtectaBrand.tsx`, `frontend/src/theme.ts`). Document OCR, MRZ, liveness, face match. The platform never touches ID images |
| `bot/` | WhatsApp bot (Cloud API webhook): every chat action writes through the backend API (`docs/WHATSAPP_BOT_FLOWS.md`). Every message carries a bold `*Protecta Bode*` heading via the `brand()` wrapper |
| `email_service/` | Transactional email microservice serving the 21-template Protecta Bode pack (`../Protecta bode/emails/`): `{{tag}}` substitution + `REPEAT:` blocks + SMTP |
| `docker-compose.yml` | One-command stack: postgres, redis, api, bot, email, kyc-db, kyc-engine, kyc-api, kyc-web, caddy (optional HTTPS) |

## Run it - one universal script

One script installs and runs the whole stack in Docker: the FastAPI backend, the
Postgres database, the portal frontend, the WhatsApp bot, the email service and the
Protecta-branded KYC stack (plus Redis; optional Caddy for HTTPS).

Prerequisites: a machine with **Docker Engine** and the **Docker compose plugin**
(`docker compose version` must work) and **git**. Nothing else - Python, Node and
Postgres all run inside containers.

```bash
git clone <this-repo>          # skip if you already have the code
cd <repo>/platform
./install.sh                   # first run: creates .env, generates secrets, builds, starts
```

What first run does, in order: copies `.env.example` to `.env` and generates fresh
secrets (`SECRET_KEY`, `INTERNAL_API_KEY`, `PAYMENT_WEBHOOK_SECRET`, `KABILA_ENCRYPTION_KEY`); checks the direct host ports are free; builds and starts postgres, redis, api, portal, bot, email and the KYC services; checks that the portal, API and KYC wizard respond; then asks whether to build/start the optional Caddy HTTPS container. Answer yes only when this VPS has DNS pointing to it and ports 80/443 are free. Answer no when AgriLink's Caddy already owns those ports.

Verify it worked:

```bash
./install.sh status                          # what is running and on which ports
curl http://localhost:18000/health           # {"status":"ok",...}
open http://localhost:18080                  # the portal
./install.sh admin                           # prints the platform admin login
```

### Portal sign-in and account onboarding

The signed-out `/` route recreates the original campaign landing page supplied at [`protectabode-landing.html`](https://github.com/iamtutumo/protecta_bode/blob/main/protectabode-landing.html) and sends visitors from its calculator to the live quote/payment flow. Its value selector is free entry (no preset-value chips). **Portal sign in** at `/login` supports the usual username/password login and a passwordless **Sign in with WhatsApp** option.

1. **All portal users:** sign in with a registered phone number or email and password, or request a one-time code over WhatsApp to the phone registered on the account. The backend determines the role and opens the assigned customer, agent, broker or staff workspace; users do not select a role. Production WhatsApp login requires `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` and `EVOLUTION_INSTANCE` in the platform `.env`; the API key is used only by the backend. Sandbox without Evolution configured displays a test code.
2. **Customer account setup/reset:** use the secondary account-setup link, request an OTP to the registered email, verify it, and set a password. A first-time customer supplies their name and email; they are created as customers only. Sandbox displays the test OTP; production requires configured email delivery.
3. **Agent or broker:** an administrator provisions the account in **User access** with its phone, email, licence and initial password; an agent can also be assigned to an existing broker. Share the credentials securely. These roles cannot self-register.
4. **Staff:** administrators, underwriters and claims handlers use the same form with assigned credentials. The first admin login is printed by `./install.sh admin`; change the seed password before production. Only an admin can provision agency/broker accounts or integration credentials.
5. **External systems:** admins add a partner under **Staff > Integrations**, share its one-time client credentials securely, and configure the partner's callback URL there. The client authenticates with `POST /api/v1/partner/auth/token`.

**Sign out** is in the portal header. Customers see cover, payments, claims, identity verification and support. Agents see their book, commissions, support and quotes. Brokers see performance, their own agent network, commissions and support. Staff see policies, payments, claims, distribution, helpdesk and reports; admins also see User access and Integrations.

New quote share links use a cryptographically random 15-digit numeric identifier, for example `/quote/583104729165083`; it does not encode a customer or vehicle detail. For step-by-step OTP/onboarding and inbound/outbound webhook contracts, see [`docs/ACCESS_AND_WEBHOOKS.md`](docs/ACCESS_AND_WEBHOOKS.md).

Data lives in Docker volumes (`pgdata`, `redisdata`, `kycdata`, ...), so
`./install.sh down` keeps the database and `up` brings it back. To pick up new code:
`./install.sh update`. To change ports or the domain, edit `.env` then `./install.sh restart`.

```bash
cd platform
./install.sh              # first-time install + start (creates .env with fresh secrets)
```

That single script builds and runs the database, API, portal, WhatsApp bot, email service and Protecta-branded KYC stack. It generates the application, integration and KYC secrets, checks ports, verifies the API/portal/KYC routes, and offers an optional Caddy HTTPS setup at the end.

| Command | What it does |
|---|---|
| `./install.sh` or `up` | install / build + start everything |
| `./install.sh down` | stop (data volumes kept) |
| `./install.sh restart` | restart the stack (picks up .env changes) |
| `./install.sh logs [service]` | follow logs |
| `./install.sh status` | what is running and on which ports |
| `./install.sh update` | rebuild with the latest code (also rebuilds Caddy if already enabled) |
| `./install.sh caddy` | build/start the optional HTTPS subdomain front door |
| `./install.sh admin` | print the platform admin login |

### Ports - chosen to coexist with a AgriLink deployment

AgriLink uses 80/443 (Caddy), 8000 (API), 8080 (portal), 3001/3002 (KYC), 8010/8011.
Protecta Bode publishes nothing in those ranges:

| Service | Host port (default) |
|---|---|
| Portal (start here) | **18080** |
| API + Swagger | **18000** |
| KYC wizard (Protecta-branded) | **18081** |
| Optional Caddy HTTPS front door | **80 / 443** |

Open the direct KYC service at `http://<VPS-IP>:18081/kyc/`; `/` redirects there. The container listens on 8080, and Compose maps the host `KYC_PORT` to that port. Override the direct ports in `.env` (`API_PORT`, `PORTAL_PORT`, `KYC_PORT`). The installer refuses direct-port conflicts. Caddy is optional and must not be enabled when AgriLink or another front door already owns 80/443.

Dev without Docker: `cd frontend && npm install && npm run dev` (proxies /api to the backend).

## API

Same API everywhere - only the base URL changes:

| Where | API base URL | Swagger UI (interactive docs) |
|---|---|---|
| Local Docker install | `http://localhost:18000/api/v1` | `http://localhost:18000/docs` |
| Live domain | `https://protectabode.weareupsyd.com/api/v1` | `https://protectabode.weareupsyd.com/docs` |
| Dev without Docker | `http://localhost:8001/api/v1` | `http://localhost:8001/docs` |

The Swagger UI is the full, always-current reference (every endpoint, schema and the
"Try it out" button). Every portal role signs in through `POST /auth/login-password` with a phone or email username and password, or through `POST /auth/request-whatsapp-otp` and `POST /auth/verify-whatsapp-otp` for a WhatsApp code; the API derives the role from the account and returns a bearer token for either flow. `POST /auth/request-otp` and `POST /auth/verify-otp` are used to set or reset account passwords; first-time customers provide their email and name and are created only with the customer role. Admins provision licensed agents and brokers with an initial password; they cannot self-register those roles. Partners use `POST /partner/auth/token`. Send the returned token as `Authorization: Bearer <token>`. Sandbox OTP requests return `debug_code` only when no delivery channel is configured.

Main endpoint groups under `/api/v1`:

| Group | Endpoints | Notes |
|---|---|---|
| `/auth` | `request-otp`, `verify-otp`, `request-whatsapp-otp`, `verify-whatsapp-otp`, `login-password`, `me` | configure production email OTP and Evolution API delivery before go-live; sandbox can return `debug_code` |
| `/quotes` | `POST /`, `GET /{reference}`, `POST /internal` | Premium = 1.5% of car value + flat extras |
| `/payments` | `POST /`, `GET /mine`, `GET /` (staff), `POST /webhook/{provider}`, `POST /{reference}/confirm-manual` | Provider callback verifies `X-PB-Signature: sha256=<HMAC-SHA256>` over the exact raw JSON body using `PAYMENT_WEBHOOK_SECRET` |
| `/policies` | `GET /mine`, `GET /` (staff), `GET /{policy_no}`, `GET /{policy_no}/document`, `POST /{policy_no}/status` | see the document endpoint below |
| `/support` | `POST /tickets`, `GET /tickets/mine`, `GET /tickets` (staff), `POST /tickets/{reference}/status` | Customer support requests and helpdesk queue |
| `/claims` | `GET /`, `POST /`, `POST /{reference}/status` | bearer auth; claim creation/status events are sent for partner-originated policies |
| `/reports` | `my-commissions`, `agent-commissions`, `agent-performance`, `broker-tree`, `daily-flash` | role-scoped |
| `/kyc` | `POST /session`, `GET /session/{session_id}`, `POST /manual-review/{user_id}` | platform never touches ID images |
| `/partner` | token, scoped customers/quotes/bind/payments/claims/commission reports, webhook events | Partner data is constrained to its own book; quote bind requires a partner-scoped `Idempotency-Key` and safely replays the original payment response |
| `/integrations` | `GET /partners`, `POST /partners`, `POST /partners/{client_id}/webhook`, `DELETE /partners/{client_id}/webhook`, `GET /webhooks/deliveries`, `POST /webhooks/deliveries/{id}/retry` | admin-only partner credentials, callback settings, signed event delivery and retry queue |
| `/users` | `GET /distribution`, `POST /onboard` | admin-only licensed agent/broker onboarding with initial password; sign in with phone/email and password |

### Policy document PDF

`GET /api/v1/policies/{policy_no}/document` returns the official Protecta Bode policy
document as a PDF. The wording is the supplied Word document, verbatim; the schedule
blanks are filled in (insured, period, proposal date, vehicle, premium block). The file
is password protected: **the password is the policyholder's phone number, digits only**
(e.g. `+256772999888` -> `256772999888`). Downloadable by the policyholder, the
originating agent/broker, and staff; the same PDF is attached to the policy-issued email.

```bash
# login, then fetch the policy PDF
TOKEN=$(...verify-otp response access_token...)
curl -H "Authorization: Bearer $TOKEN" \
     -o PB-2026-34200A.pdf \
     http://localhost:18000/api/v1/policies/PB-2026-34200A/document
# open PB-2026-34200A.pdf and enter the phone number (digits only) as the password
```


## Going live on weareupsyd.com

**Subdomain: `protectabode.weareupsyd.com`** (set the actual host in `DOMAIN`; any extra alias needs its own Caddy site address and DNS record)

KYC keeps the exact URL pattern AgriLink used - the verification wizard lives on
the same domain under `/kyc` (`agrilink.weareupsyd.com/kyc` becomes
`protectabode.weareupsyd.com/kyc`). The frontend is built with Vite base
`/kyc/`, same-origins its API at `/kyc/api/*` (nginx strips and proxies to
`kyc-api:3001`), and the backend builds handoff links from
`KYC_PUBLIC_URL=https://protectabode.weareupsyd.com/kyc`. Direct access to
`http://<VPS-IP>:18081/` redirects to `/kyc/`; Compose publishes the KYC web
container's actual nginx port 8080 on host port 18081.

Create these records at the DNS provider for weareupsyd.com, pointing at the VPS IP:

```
A    protectabode    <VPS-IP>    TTL 300
```

This subdomain does not clash with `agrilink.weareupsyd.com`. Routing is a single origin, same pattern as AgriLink:

| Path | Service |
|---|---|
| `/` | portal (frontend) |
| `/api/*`, `/docs`, `/openapi.json` | FastAPI backend |
| `/kyc/*` | Protecta-branded verification wizard (container port 8080) |
| `/webhook` | WhatsApp Cloud API callback to the bot |

Two HTTPS options:

1. **AgriLink's Caddy stays the host front door (recommended when both stacks share one VPS).**
   Answer **no** to the installer's Caddy prompt. Add the site block from
   `platform/caddy/Caddyfile` to the running Caddy (it needs the `protecta-bode`
   compose network: `docker network connect protecta-bode_default <caddy-container>`).
   Set the existing Caddy container's `DOMAIN` environment variable or replace
   `{$DOMAIN}` with the actual host, then set `PUBLIC_BASE_URL` and `KYC_PUBLIC_URL`
   in `.env` to the HTTPS subdomain.
2. **Dedicated host / AgriLink moved:** after DNS points at this VPS and ports
   80/443 are free, answer **yes** to the installer's prompt or run
   `./install.sh caddy`. Caddy obtains HTTPS certificates for `DOMAIN`. Never
   enable this profile on a host where another Caddy already holds 80/443.

DNS caveats: ports 80/443 must be reachable for the Let's Encrypt HTTP-01
challenge; if the zone is proxied through Cloudflare, use SSL Full(strict) or a
DNS-only record initially so the first certificate issues cleanly.

## Backend tests

```bash
cd backend && pip install -r requirements.txt && pip install pytest
pytest tests -q
```

## KYC brand notes

The verification wizard is the vendor's engine with a Protecta Bode skin:

- `kyc/frontend/src/protecta/ProtectaBrand.tsx` - supplied Protecta Bode wordmark; the umbrella graphic is reserved for favicon artwork
- `kyc/frontend/src/theme.ts` - accent tokens swapped to Protecta orange (`#CA6E2B` / `#E08A45` in dark mode); paper/ink neutrals kept
- `kyc/frontend/public/protecta/` - favicon/touch icons cut from the platform `favicon.ico`, umbrella.svg
- Titles, meta and all user-facing strings say Protecta Bode; theme colour `#0B1C48`

## House rules

No emojis, no em/en dashes in product copy or code (plain ASCII hyphens). Icons come from
HugeIcons. WhatsApp messages open with the bold `*Protecta Bode*` heading (enforced by the
bot's `brand()` wrapper). See `../PROTECTA_BODE_ENHANCEMENT_PLAN.md` for the full plan.
