# Kabila - Open-Source Identity Verification

[![License: MIT](https://img.shields.io/badge/License-MIT-22d3ee.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/weareupsyd/kabila)](https://github.com/weareupsyd/kabila/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/weareupsyd/kabila)](https://github.com/weareupsyd/kabila/issues)

Self-hostable identity verification platform for developers. Document OCR, barcode/MRZ parsing, cross-validation, liveness detection, and face matching - all in one API, running on your infrastructure.

**[Website](https://kabila.app)** | **[Documentation](https://kabila.app/docs)** | **[Demo](https://kabila.app/demo)** | **[Pricing](https://kabila.app/pricing)**

---

## Self-Host in One Command

```bash
git clone https://github.com/weareupsyd/kabila.git && cd kabila && docker compose up -d --build
```

Docker Compose builds the API, engine, and frontend from the checked-out source, then starts them. Visit `http://localhost:8080` to access the developer portal.

On the first visit, complete the setup wizard with a name and email, then copy the API key shown on the success screen. It is shown only once and cannot be recovered by the bundle credential report. Later portal logins use email OTP. See the bundle's [Application Logins and API Keys](../../CREDENTIALS.md) guide.

The Community Edition is **free forever** - unlimited verifications, full source code, MIT license. Your data stays on your servers.

### Prerequisites

| Dependency | Minimum Version | Check |
|------------|----------------|-------|
| **Docker** | 20.10+ | `docker --version` |
| **Docker Compose** | V2 (plugin) | `docker compose version` |
| **Git** | Any | `git --version` |
| **Node.js** | 24+ (source development only) | `node --version` |

Docker Compose V2 ships as a plugin with Docker Desktop and recent Docker Engine installs. If `docker compose` doesn't work, install the [compose plugin](https://docs.docker.com/compose/install/).

**OS support:** Any Linux distribution (Debian, Ubuntu, RHEL, Alpine), macOS, or Windows with Docker Desktop. Production deployments are recommended on Linux.

### Interactive Setup (Recommended)

For guided configuration, secret generation, local builds, and startup:

```bash
git clone https://github.com/weareupsyd/kabila.git
cd kabila
./install.sh
```

The install script will:
- Verify Docker and Docker Compose are installed
- Build the API, engine, and frontend locally from the checked-out source
- Generate secure random values for `JWT_SECRET`, `API_KEY_SECRET`, `ENCRYPTION_KEY`
- Create a `.env` file with your configuration
- Start all services and wait for health checks

### Build from Source

Source builds are the only supported application deployment path:

```bash
# Guided setup, local build, and startup
./install.sh

# Or configure .env and run Compose directly
cp .env.example .env
docker compose up -d --build
```

The first build can take 15-30 minutes because the ML and Node dependencies are compiled on the host. Later builds reuse Docker's local layer cache. Third-party infrastructure such as PostgreSQL still uses its official upstream image.

#### Optional voice authentication image

The default engine image is intentionally smaller: it excludes the Sherpa ONNX
speaker/ASR package, voice models, and ffmpeg. The API reports the capability as
unavailable and ignores any stale enabled preference, so existing databases do
not route users into a missing voice step.

To build the full voice-capable variant, set the following before rebuilding
both the engine and API configuration:

```bash
# .env
WITH_VOICE_AUTH=true
docker compose up -d --build
```

Switching back to `false` does not erase a developer's stored preference; it is
masked while the capability is unavailable and becomes effective again after a
full voice-enabled rebuild.

### What Gets Deployed

| Service    | Description                              | Port  | Image footprint |
|------------|------------------------------------------|-------|-----------------|
| `postgres` | PostgreSQL 16 database                   | 5432  | Pinned Alpine upstream image |
| `engine`   | ML verification engine (OCR, face, liveness) | 3002 | Largest image; voice assets are opt-in |
| `api`      | Core API (lightweight orchestrator)      | 3001  | Production dependencies only |
| `frontend` | Developer portal (React)                 | 8080  | Static bundle on slim non-root nginx |

Image sizes vary by architecture and upstream model revisions. From the bundle
root, run `./image-report.sh` after a build to report uncompressed sizes and
actual disk use after shared layers are accounted for.

### Server Requirements

The ML engine is the most resource-intensive component. Minimum and recommended specs:

| | Minimum | Recommended | High Volume |
|---|---|---|---|
| **CPU** | 2 vCPUs | 4 vCPUs | 8+ vCPUs |
| **RAM** | 4 GB | 8 GB | 16 GB |
| **Disk** | 20 GB | 50 GB | 100+ GB |
| **Throughput** | ~10 req/s | ~30 req/s | ~80+ req/s |
| **Use case** | Dev/testing, low traffic | Small-to-medium production | High-traffic production |

**Minimum (2 vCPU / 4GB)** - Handles ~10 concurrent verifications/sec with comfortable headroom. The engine uses ~1.5GB RAM at idle and spikes during ML inference. Suitable for startups processing up to a few hundred verifications per day.

**Recommended (4 vCPU / 8GB)** - Comfortable for production workloads. Extra cores significantly improve OCR and face detection throughput since these operations parallelize well.

**Storage note:** Disk usage grows with verification volume. Each verification stores uploaded documents (~2-5MB per session). Configure `RETENTION_DAYS` to auto-delete expired data.

> **Tested on:** 2 vCPU / 4GB RAM (AMD EPYC, Hetzner CX22) - sustained 15 req/s with p95 < 400ms, rate limiter engaged at higher loads, clean recovery under stress.

### HTTPS in the KYC Bundle

Kabila does not start its own TLS proxy. The bundle-level `KYC_bundle/Caddyfile` owns ports 80 and 443 and proxies `kabila.weareupsyd.com` to the frontend on port 8080. Keep `KABILA_PORT=8080` when using the bundle.

For a standalone deployment, place your own Caddy, nginx, or load balancer in front of port 8080 and set `CORS_ORIGINS` and `FRONTEND_URL` to the public HTTPS origin.

### Custom Ports

If you run the stack on a non-standard port (e.g. `KABILA_PORT=8081:8080` so the frontend is reachable at `http://yourhost:8081`), you also need to set `FRONTEND_URL` to that exact origin so the backend generates outbound links - verification page URLs, credential verify links, and reset links - that include the port:

```bash
# In .env
KABILA_PORT=8081:8080
FRONTEND_URL=http://yourhost:8081
```

The `install.sh` script does not auto-populate `FRONTEND_URL` when you choose a custom port - set it yourself or your `verification_url` responses will point at a port the client can't reach. Standard ports (80, 443) work without `FRONTEND_URL` if `DOMAIN` is set.

### Email (OTP login, credential delivery)

Kabila sends developer-portal login codes and verified credential emails through **Resend** - there is no SMTP path. Self-hosters need a Resend account (free tier covers small deployments) to receive OTP codes; without it, OTP codes are logged to the API container's stdout for testing-only use.

```bash
# In .env - required for email-based OTP login on self-host
RESEND_API_KEY=re_your_key_here
EMAIL_FROM=noreply@yourdomain.com
```

Steps:
1. Sign up at <https://resend.com> (free tier covers small self-hosts).
2. Verify a sending domain in the Resend dashboard.
3. Set `RESEND_API_KEY` and `EMAIL_FROM` in `.env`, then `docker compose up -d` to restart the API.
4. To inspect logged OTPs while Resend is not yet configured: `docker compose logs api | grep -i OTP`.

There is no built-in registration allowlist (no `ALLOWED_ADMIN_EMAILS` / `AUTH_WHITELIST_EMAILS` - those don't exist; AI assistants sometimes hallucinate these). To restrict who can register, front the API with a reverse proxy that allowlists by IP or basic-auth, or open a feature request if a built-in allowlist would help your deployment.

### Production Deployments & Rollback

Deploy a reviewed Git revision on the server and build that revision locally:

```bash
git fetch --tags origin
git checkout v1.2.0             # or a reviewed commit SHA
docker compose up -d --build --remove-orphans
docker compose ps
```

Before upgrading, record the current revision with `git rev-parse HEAD` and back up persistent data. To roll back, check out that recorded revision and run the same `docker compose up -d --build --remove-orphans` command. Docker's local cache speeds up rebuilds, while application state remains in the named volumes.

### Backup & Restore

For production self-hosted deployments, see the dedicated runbook at
[`backend/scripts/self-hosted-backups.md`](backend/scripts/self-hosted-backups.md).
Covers daily database snapshots, uploads volume backup, `.env`
preservation, monthly restore drills, and RTO/RPO targets. Skip if
you're running this in a sandbox where data loss is acceptable.

### Uninstall

To cleanly remove Kabila from your server:

```bash
cd kabila
bash uninstall.sh
```

The uninstall script will:
- Stop and remove all containers and networks
- Remove database volumes (all verification data)
- Remove locally built Docker images (`kabila-api:local`, `kabila-engine:local`, and `kabila-frontend:local`)
- Clean up generated config files (`.env`, `Caddyfile`)
- Optionally delete the installation directory

**Options:**

| Flag | Description |
|------|-------------|
| `--yes` | Skip confirmation prompts (non-interactive) |
| `--keep-data` | Remove containers but preserve the database volume |

```bash
# Non-interactive full removal
bash uninstall.sh --yes

# Remove containers but keep your database for reinstall
bash uninstall.sh --keep-data
```

---

## How It Works

```
Front of ID ──► OCR + Barcode ──► Cross-Validation ──► Live Capture ──► Face Match ──► Result
```

1. **Create a session** - `POST /api/v2/verify/initialize`
2. **Upload front of ID** - OCR extracts name, DOB, document number, expiry
3. **Upload back of ID** - Barcode (PDF417) or MRZ parsed and cross-validated against front
4. **Live capture** - Real-time liveness detection confirms a real person is present
5. **Face match** - Live capture compared against document photo
6. **Result** - `verified`, `failed`, or `manual_review` delivered via API and webhook

---

## Features

**Core Verification**
- Document OCR via PaddleOCR (passports, driver's licenses, national IDs)
- PDF417 barcode parsing (US) and MRZ parsing (TD1/TD2/TD3 international)
- Cross-validation engine - front OCR vs back barcode/MRZ, inconsistencies flagged
- Liveness detection with anti-spoof scoring
- Face matching with configurable confidence thresholds
- 19-country format registry with country-aware extraction

**Integration**
- REST API with API key authentication
- JavaScript SDK (`npm install @kabila/sdk`) with drop-in embed component
- Hosted verification page - redirect users, zero frontend work
- Webhooks with retry logic (up to 3 attempts) and delivery status
- Batch API for bulk verification processing

**Security & Compliance**
- Encryption at rest for documents stored via S3-compatible providers (server-side AES256). For `STORAGE_PROVIDER=local`, rely on filesystem-level encryption (LUKS, dm-crypt, EBS).
- GDPR/CCPA compliant data handling with configurable retention
- HTTPS-only communication
- Audit logging for verification activities
- Sandbox mode for safe testing

**Developer Experience**
- Full API integration in under 30 minutes
- Developer portal with API key management
- Admin dashboard for monitoring and manual review
- Rate limiting and abuse protection

---

## Quick Start (API)

### JavaScript

```javascript
const BASE = 'https://api.kabila.app'  // or http://localhost:3001
const h = { 'X-API-Key': 'your-api-key' }

// 1. Create session
const { verification_id } = await fetch(`${BASE}/api/v2/verify/initialize`, {
  method: 'POST',
  headers: { ...h, 'Content-Type': 'application/json' },
  body: JSON.stringify({ document_type: 'drivers_license' }),
}).then(r => r.json())

// 2. Upload front of ID
const front = new FormData()
front.append('document', frontFile)
await fetch(`${BASE}/api/v2/verify/${verification_id}/front-document`, {
  method: 'POST', headers: h, body: front
})

// 3. Upload back of ID
const back = new FormData()
back.append('document', backFile)
await fetch(`${BASE}/api/v2/verify/${verification_id}/back-document`, {
  method: 'POST', headers: h, body: back
})

// 4. Live capture for liveness + face match
const capture = new FormData()
capture.append('image', captureFile)
await fetch(`${BASE}/api/v2/verify/${verification_id}/live-capture`, {
  method: 'POST', headers: h, body: capture
})

// 5. Get results
const result = await fetch(`${BASE}/api/v2/verify/${verification_id}/status`, {
  headers: h
}).then(r => r.json())
console.log(result.status) // 'verified' | 'failed' | 'manual_review'
```

### Python

```python
import requests

BASE = "https://api.kabila.app"  # or http://localhost:3001
H = {"X-API-Key": "your-api-key"}

# 1. Create session
r = requests.post(f"{BASE}/api/v2/verify/initialize",
    json={"document_type": "drivers_license"}, headers={**H, "Content-Type": "application/json"})
verification_id = r.json()["verification_id"]

# 2-4. Upload documents and live capture
requests.post(f"{BASE}/api/v2/verify/{verification_id}/front-document",
    files={"document": open("front.jpg", "rb")}, headers=H)
requests.post(f"{BASE}/api/v2/verify/{verification_id}/back-document",
    files={"document": open("back.jpg", "rb")}, headers=H)
requests.post(f"{BASE}/api/v2/verify/{verification_id}/live-capture",
    files={"image": open("capture.jpg", "rb")}, headers=H)

# 5. Get results
result = requests.get(f"{BASE}/api/v2/verify/{verification_id}/status", headers=H).json()
print(result["status"])  # 'verified' | 'failed' | 'manual_review'
```

---

## Webhooks

Instead of polling `GET /api/v2/verify/:id/status`, you can register an HTTPS endpoint in the **Developer Portal -> Webhooks** section and Kabila will `POST` JSON events to it as they happen.

### Setup
1. Build an endpoint on your backend that accepts `POST` requests (e.g. `https://your-app.com/kabila/webhook`).
2. In the portal, paste the URL, pick which events to subscribe to (or "select all"), optionally scope it to a single API key, and click **+ Add Webhook**.
3. Copy the generated **signing secret** (shown once; available later via the Reveal button) - use it to verify every delivery before trusting it.

### Events

| Event | Fires when |
|---|---|
| `verification.started` | A new verification session is created (`/initialize`) |
| `verification.document_processed` | Front or back document finishes OCR + cross-validation |
| `verification.completed` | Final status is `verified` |
| `verification.failed` | Final status is `failed` (hard reject or gate failure) |
| `verification.manual_review` | Verification is flagged for human review |
| `document.expiry_warning` | Uploaded document is near or past its expiry date |
| `verification.reverification_due` | A scheduled re-verification becomes due |

### Payload shape (envelope)

Every delivery uses the same envelope. The `data` object varies slightly per event.

```json
{
  "event": "verification.completed",
  "user_id": "c0d0ffee-1234-5678-90ab-cdef00000001",
  "verification_id": "a1b2c3d4-5678-90ef-1234-567890abcdef",
  "status": "verified",
  "timestamp": "2026-08-05T12:34:56.000Z",
  "is_service": false,
  "data": {
    "ocr_data": {
      "full_name": "JANE AOCHIENG OWINO",
      "date_of_birth": "1992-04-18",
      "id_number": "CM12345678P9XYZ",
      "issuing_country": "UG",
      "address": "BUKOTO, KAWEMPE DIVISION, KAMPALA"
    },
    "face_match_score": 0.94,
    "failure_reason": null
  }
}
```

### Request headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `User-Agent` | `Kabila-Webhooks/1.0` |
| `X-Kabila-Webhook-Id` | UUID of this delivery row (use for idempotency / support) |
| `X-Kabila-Delivery-Attempt` | `1`, `2`, `3`… (increments on retries) |
| `X-Kabila-Sandbox` | `"true"` / `"false"` |
| `X-Kabila-Verification-Mode` | `"sandbox"` or `"production"` |
| `X-Kabila-Signature` | `sha256=<hex>` - HMAC-SHA256 of the raw body, signed with your webhook secret |
| `X-Kabila-Is-Service` | Present only when the call came from a service/operator key |
| `X-Kabila-Service-Product` | Service-key product label (when applicable) |
| `X-Kabila-Service-Environment` | Service-key environment label (when applicable) |

### Verifying the signature (Node.js example)

Always verify `X-Kabila-Signature` before trusting a payload - otherwise anyone on the internet can POST fake events to you. Compute the HMAC over the **raw request body** (not the re-serialized parsed JSON - key order can change).

```js
// Express - use express.raw for this route so req.body is a Buffer
const crypto = require('crypto');
const express = require('express');
const app = express();

const WEBHOOK_SECRET = process.env.KABILA_WEBHOOK_SECRET; // from the portal

app.post('/kabila/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-kabila-signature'];
  const expected = 'sha256=' + crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(req.body)
    .digest('hex');

  // timingSafeEqual prevents timing attacks
  const sigBuf = Buffer.from(signature || '', 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return res.status(401).send('bad signature');
  }

  const payload = JSON.parse(req.body.toString('utf8'));

  switch (payload.event) {
    case 'verification.completed':
      // e.g. mark the user verified in your DB, trigger onboarding
      console.log('verified', payload.verification_id, payload.data.ocr_data.full_name);
      break;
    case 'verification.failed':
      console.log('failed', payload.data.failure_reason);
      break;
    case 'verification.manual_review':
      // queue for human review
      break;
    default:
      // unhandled event - ACK anyway so Kabila doesn't retry
      break;
  }

  res.sendStatus(200); // any 2xx = success; 5xx/timeout triggers retries
});

app.listen(3000);
```

### Retries & reliability

- 5xx responses, network errors, and timeouts trigger automatic retries with exponential backoff (~1 min -> 5 min -> 15 min, capped).
- 4xx responses are treated as intentional rejection and are **not** retried (return 401 for bad signatures rather than 500).
- All deliveries are logged in the portal under **Active endpoints -> Recent deliveries** with request payload, response code, response body, and a manual **Resend** button for failed deliveries.
- A built-in SSRF guard blocks delivery to RFC1918 private IPs / metadata services / loopback addresses when not running in dev mode.

### Security notes

- Secrets are stored encrypted at rest.
- HTTPS (TLS 1.2+) is required for non-localhost URLs.
- Always use `X-Kabila-Sandbox` / `X-Kabila-Verification-Mode` to avoid processing sandbox test data as real verifications.
- Use `X-Kabila-Webhook-Id` as an idempotency key if your side effects (emails, DB writes) must not run twice.

---

## Architecture

```
frontend/          React + Vite developer portal
backend/           Node.js + TypeScript core API (lightweight orchestrator)
  src/
    routes/        API endpoints (v2)
    services/      Webhook delivery, API key management, engine client
    verification/  Session state machine, cross-validation, face matching
    config/        Dynamic thresholds, verification config
engine/            ML verification engine (separate microservice)
  src/
    routes/        Extraction endpoints (front, back, live)
    services/      OCR, barcode, face recognition
    providers/     PaddleOCR, liveness, tampering, deepfake detection
docker-compose.yml One-command self-hosted deployment (4 containers)
install.sh         Interactive setup script
```

The core API (~250MB) handles routing, sessions, webhooks, and API key management. Heavy ML operations (OCR, face detection, liveness, deepfake analysis) run in a separate Engine Worker container (~1.5GB), called via HTTP only during verifications.

**Tech stack:** Node.js, TypeScript, Express, React, Vite, PostgreSQL, PaddleOCR, TensorFlow (face detection), ONNX Runtime, Tailwind CSS

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_NAME` | PostgreSQL database name | `kabila` |
| `DB_USER` | PostgreSQL username | `kabila` |
| `DB_PASSWORD` | PostgreSQL password | required |
| `DATABASE_URL` | PostgreSQL connection string (auto-built in Docker) | required |
| `JWT_SECRET` | Secret for auth tokens | required |
| `API_KEY_SECRET` | Secret for API key generation | required |
| `ENCRYPTION_KEY` | 32-byte hex master key - encrypts stored secrets (LLM API keys, webhook secrets) at the application layer | required |
| `PORT` | API server port | `3001` |
| `NODE_ENV` | `development` or `production` | `development` |
| `STORAGE_PROVIDER` | `local`, `s3`, or `supabase`. `s3` is the only provider with built-in encryption at rest today. | `local` |
| `SANDBOX_MODE` | Enable sandbox for testing | `false` |
| `ENGINE_URL` | Engine worker URL (auto-set in Docker) | `http://engine:3002` |

### Database Migrations

The backend includes a lightweight migration runner:

```bash
cd backend
npm run migrate
```

This creates a `_migrations` tracking table, applies pending SQL files in order, and skips already-applied migrations.

---

## Development Setup

If you want to run from source (without Docker):

```bash
# Prerequisites: Node.js 24+, PostgreSQL

# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env with your DATABASE_URL, JWT_SECRET, etc.

# Run migrations
cd backend && npm run migrate

# Start dev servers
cd backend && npm run dev      # API on :3001
cd frontend && npm run dev     # Portal on :5173
```

### Testing

```bash
cd backend && npm test         # Vitest test suite
cd backend && npm run type-check  # TypeScript check
```

---

## Editions

| | Community (Self-Hosted) | Cloud |
|---|---|---|
| **Price** | Free forever | From $0/mo |
| **Verifications** | Unlimited | 50 - 2,000/mo |
| **Hosting** | Your infrastructure | Managed by Kabila |
| **Support** | GitHub issues | Email / Priority |
| **Source code** | Full access (MIT) | N/A |

**Cloud** is available at [kabila.app](https://kabila.app) - same engine, managed infrastructure.

See the [full pricing comparison](https://kabila.app/pricing).

---

## Contributing

Contributions are welcome. Please:

1. Fork the repository
2. Create a branch from `dev`: `git checkout -b feature/my-feature`
3. Make your changes with clear commit messages
4. Run `npm test` and `npm run type-check` in the backend
5. Open a Pull Request targeting `dev` (not `main`)

For large features, open an issue first to discuss the approach.

---

## License & Trademarks

**Code:** MIT License. See [LICENSE](./LICENSE). Use it commercially, modify it, distribute it.

**Brand:** The Kabila name and logo are trademarks. Self-hosted deployments of the default UI must retain the "Powered by Kabila" footer. See [TRADEMARK.md](./TRADEMARK.md) for the full policy.

**White-label:** Want to remove Kabila branding? [Enterprise licenses](https://enterprise.kabila.app) are available.

---

## Links

- **Website:** [kabila.app](https://kabila.app)
- **Documentation:** [kabila.app/docs](https://kabila.app/docs)
- **Demo:** [kabila.app/demo](https://kabila.app/demo)
- **Issues:** [github.com/weareupsyd/kabila/issues](https://github.com/weareupsyd/kabila/issues)
- **Enterprise:** [enterprise.kabila.app](https://enterprise.kabila.app)
