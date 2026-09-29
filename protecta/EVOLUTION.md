# Evolution API + Twenty CRM + Caddy — Protecta Bode

This document explains the default webhook that makes the WhatsApp bot talk to Twenty CRM and the Caddy configuration for `https://protectabode.weareupsyd.com` when running `./install.sh`.

## Architecture

```
WhatsApp User
     ↓
Evolution API (atendai/evolution-api) on :8080
     ↓ POST /s/protecta/whatsapp/webhook
Caddy (TLS for protectabode.weareupsyd.com) :443 → localhost:2020
     ↓
Twenty CRM (twenty-app-dev container) :2020
     ↓
Protecta Bode logic functions (bot-inbound, whatsapp-webhook)
```

## Default webhook URL

**Production:** `https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook`

**Local dev:** `http://localhost:2020/s/protecta/whatsapp/webhook` or `https://protectabode.weareupsyd.com` when Caddy is enabled.

This is the URL you must configure in Evolution API so inbound WhatsApp messages reach Twenty.

### Evolution API webhook payload

Evolution expects:

```json
{
  "webhook": {
    "enabled": true,
    "url": "https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook",
    "byEvents": false,
    "base64": false,
    "events": ["MESSAGES_UPSERT"]
  }
}
```

See `scripts/evolution-webhook.json` for the full template.

### How to set it

#### Automatic via install.sh

```bash
./install.sh --with-caddy --with-evolution --domain protectabode.weareupsyd.com --email admin@weareupsyd.com
```

This will:
1. Install Caddy (if missing) and write `/etc/caddy/Caddyfile` from `protecta/Caddyfile`
2. Set `PUBLIC_BASE_URL=https://protectabode.weareupsyd.com` via `scripts/set-public-url.sh`
3. Create `.env.evolution` with random API key and `WEBHOOK_URL=https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook`
4. Start `evolution-api` + `caddy` via `docker compose -f docker-compose.caddy.yml up -d`
5. Call `scripts/setup-evolution-webhook.sh` to register the webhook on the Evolution instance

#### Manual via script

```bash
export EVOLUTION_API_URL=http://localhost:8080
export EVOLUTION_INSTANCE=protecta
export EVOLUTION_API_KEY=your-api-key-from-env
export WEBHOOK_URL=https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook

./scripts/setup-evolution-webhook.sh
# or
./scripts/setup-evolution-webhook.sh --base-url http://localhost:8080 --instance protecta --api-key xxx --webhook https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook
```

#### Manual via curl

```bash
curl -X POST \
  -H "apikey: YOUR_EVOLUTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook",
      "byEvents": false,
      "base64": false,
      "events": ["MESSAGES_UPSERT"]
    }
  }' \
  http://localhost:8080/webhook/set/protecta
```

Verify:

```bash
curl -H "apikey: YOUR_KEY" http://localhost:8080/webhook/find/protecta | jq
```

#### Via Evolution dashboard

1. Open `http://localhost:8080` or `https://evolution.protectabode.weareupsyd.com`
2. Go to your instance `protecta` → Webhook
3. Set URL: `https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook`
4. Enable, events: `MESSAGES_UPSERT`, byEvents: false
5. Save

## Caddy configuration

### Caddyfile template (`protecta/Caddyfile`)

Managed by `scripts/setup-caddy.sh` and `install.sh --with-caddy`.

Main domain `protectabode.weareupsyd.com` reverse proxies to `localhost:2020` (Twenty).
Evolution subdomain `evolution.protectabode.weareupsyd.com` proxies to `localhost:8080`.

The bare domain (`/`) and any legacy `/admin` URL redirect to the public
Protecta Bode site at `/s/protecta/`, so the domain never opens the CRM
sign-in or another app's admin panel. Staff sign in at `/welcome`; the CRM
admin panel is `/settings/admin-panel` after signing in. Everything else
(`/s/...`, `/objects/...`, `/settings/...`, `/healthz`, APIs) proxies to
Twenty unchanged. Re-run `./scripts/setup-caddy.sh` on an existing install to
pick up routing changes (`start.sh` does not touch Caddy).

Caddy auto-provisions TLS via Let's Encrypt. Ensure DNS:

```
A  protectabode.weareupsyd.com          → YOUR_SERVER_IP
A  evolution.protectabode.weareupsyd.com → YOUR_SERVER_IP
```

Or wildcard:

```
A  *.protectabode.weareupsyd.com → YOUR_SERVER_IP
```

### Install Caddy manually

```bash
# Via script (recommended)
./scripts/setup-caddy.sh --domain protectabode.weareupsyd.com --port 2020 --email admin@weareupsyd.com

# Or via docker compose (alternative)
docker compose -f docker-compose.caddy.yml up -d
# With custom domain:
DOMAIN=protectabode.weareupsyd.com EVOLUTION_DOMAIN=evolution.protectabode.weareupsyd.com docker compose -f docker-compose.caddy.yml up -d
```

Caddyfile location:
- Native: `/etc/caddy/Caddyfile`
- Docker: `./Caddyfile` mounted to `/etc/caddy/Caddyfile` in container

Logs:
- `/var/log/caddy/protectabode.log`
- `/var/log/caddy/evolution.log` (if evolution subdomain enabled)
- `docker logs -f caddy` (docker mode)
- `docker logs -f evolution-api`

Reload after changes:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
# or
sudo systemctl reload caddy
```

### docker-compose.caddy.yml

Optional stack that runs Caddy + Evolution API alongside Twenty (Twenty itself still runs via `twenty docker:start`).

```yaml
# See protecta/docker-compose.caddy.yml
# - caddy:2-alpine on :80/:443, host network so it reaches localhost:2020
# - evolution-api on :8080 with WEBHOOK_GLOBAL_URL=https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook
```

Environment file `.env.evolution` is auto-created by `install.sh --with-evolution`:

```
DOMAIN=protectabode.weareupsyd.com
EVOLUTION_DOMAIN=evolution.protectabode.weareupsyd.com
WEBHOOK_URL=https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook
EVOLUTION_API_KEY=protecta-evolution-key-xxx
```

## install.sh flags

| Flag | Meaning |
|------|---------|
| `--domain <domain>` | Public domain, default `protectabode.weareupsyd.com` |
| `--email <email>` | Email for Let's Encrypt, default `admin@weareupsyd.com` |
| `--with-caddy` | Install and configure Caddy for DOMAIN |
| `--with-evolution` | Run Evolution API via docker compose with default webhook |
| `--evolution-domain <domain>` | Evolution subdomain, default `evolution.protectabode.weareupsyd.com` |
| `--webhook-url <url>` | Override webhook URL, default `https://DOMAIN/s/protecta/whatsapp/webhook` |
| `--port <n>` | Twenty port, default 2020 |
| `--skip-prereqs` | Don't install Node/Docker |
| `--no-verify` | Skip verification |
| `--reseed` | Re-seed workspace |

Example full production install:

```bash
curl -fsSL https://raw.githubusercontent.com/Weareupsyd/twenty/main/protecta/install.sh | bash -s -- --with-caddy --with-evolution --domain protectabode.weareupsyd.com --email admin@weareupsyd.com

# Or from checkout:
./install.sh --with-caddy --with-evolution --domain protectabode.weareupsyd.com --email admin@weareupsyd.com

# After install, create Evolution instance and QR scan:
# Open https://evolution.protectabode.weareupsyd.com or http://YOUR_IP:8080
# Create instance "protecta" → scan QR with bot phone
# Webhook is auto-set to https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook
# Test: send "menu" on WhatsApp to bot number
```

## Troubleshooting

**Caddy TLS fails:**
- DNS not pointing to server: `dig protectabode.weareupsyd.com` should return server IP
- Firewall blocking 80/443: `sudo ufw allow 80,443/tcp`
- Check logs: `sudo journalctl -u caddy -f` or `cat /var/log/caddy/protectabode.log`

**Evolution webhook not receiving:**
- Evolution must reach `https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook` (not localhost when using public domain)
- Check webhook: `curl -H "apikey: KEY" http://localhost:8080/webhook/find/protecta`
- Check Twenty logs: `docker logs -f twenty-app-dev | grep -i whatsapp`
- Re-set webhook: `./scripts/setup-evolution-webhook.sh --webhook https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook`

**Bot not replying:**
- Instance state must be `open`: `curl -H "apikey: KEY" http://localhost:8080/instance/connectionState/protecta`
- If `close`, re-scan QR in Evolution dashboard
- Check bot menus: main sidebar → WhatsApp bot → Menus & Welcome tab

**PUBLIC_BASE_URL not set:**
- Set via UI: Settings → Apps → Protecta Bode → Variables → PUBLIC_BASE_URL = `https://protectabode.weareupsyd.com`
- Or via script: `./scripts/set-public-url.sh https://protectabode.weareupsyd.com`

## Related files

- `Caddyfile` — Caddy reverse proxy template
- `docker-compose.caddy.yml` — optional Caddy + Evolution stack
- `scripts/setup-caddy.sh` — install and configure Caddy natively
- `scripts/setup-evolution-webhook.sh` — set Evolution webhook to Twenty
- `scripts/set-public-url.sh` — set PUBLIC_BASE_URL variable
- `scripts/evolution-webhook.json` — example webhook payload
- `install.sh` — now supports `--with-caddy --with-evolution --domain`
