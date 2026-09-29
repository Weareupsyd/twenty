# Caddy configs for Protecta Bode

This folder holds optional custom certificates (if you don't want Let's Encrypt).

## Structure

```
protecta/
├── Caddyfile                  ← main Caddyfile template, used by install.sh --with-caddy
├── docker-compose.caddy.yml   ← optional stack: caddy + evolution-api
├── caddy/
│   ├── certs/                 ← optional custom certs (git-ignored)
│   │   └── .gitkeep
│   └── README.md              ← this file
└── scripts/
    ├── setup-caddy.sh         ← install & configure Caddy natively
    ├── setup-evolution-webhook.sh ← set Evolution webhook to Twenty
    └── set-public-url.sh      ← set PUBLIC_BASE_URL variable
```

## Quick start with install.sh

```bash
# Full production setup for https://protectabode.weareupsyd.com
./install.sh --with-caddy --with-evolution --domain protectabode.weareupsyd.com --email admin@weareupsyd.com

# Custom domain
./install.sh --with-caddy --domain mydomain.com --email me@mydomain.com
```

## Manual Caddy setup

```bash
./scripts/setup-caddy.sh --domain protectabode.weareupsyd.com --port 2020 --email admin@weareupsyd.com
```

Routing on the main domain:

- `/` and `/admin` (plus `/admin/*`) → redirect to the public Protecta Bode
  site `/s/protecta/`, so the domain never opens the CRM sign-in or another
  app's admin panel
- everything else (`/s/...`, `/welcome`, `/objects/...`, `/settings/...`,
  APIs) → reverse proxy to the Twenty server on `localhost:PORT`

Re-run `setup-caddy.sh` after changing the `Caddyfile` template — `start.sh`
does not touch Caddy.

## Docker Caddy setup

```bash
# Uses Caddyfile + docker-compose.caddy.yml
docker compose -f docker-compose.caddy.yml up -d

# Logs
docker logs -f caddy
docker logs -f evolution-api
```

## Default webhook for Evolution API

Evolution must POST to Twenty CRM at:

```
https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook
```

Set via:

```bash
./scripts/setup-evolution-webhook.sh --webhook https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook
```

Or via Evolution dashboard: Instance → Webhook → URL = `https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook`, events = `MESSAGES_UPSERT`.

## DNS

```
A  protectabode.weareupsyd.com           → YOUR_SERVER_IP
A  evolution.protectabode.weareupsyd.com → YOUR_SERVER_IP
```

Caddy will auto-provision TLS certificates via Let's Encrypt once DNS points correctly and ports 80/443 are open.

## Troubleshooting

- `sudo systemctl status caddy`
- `sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`
- `cat /var/log/caddy/protectabode.log`
- `curl -i http://localhost:2020/healthz` should return 200
- `curl -i https://protectabode.weareupsyd.com/healthz` should also return 200 after TLS
