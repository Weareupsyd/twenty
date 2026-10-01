# Protecta Bode

Motor insurance on Twenty CRM: 1.5% quotes, mobile-money payments, policies,
claims, a WhatsApp bot, automatic agent commissions, and a partner API.

When a policy is created or updated with an **Agent** relation, Protecta creates
an idempotent accrued commission from the policy premium. Set the agent's
**Commission rate (fraction)** on their Person record (for example `0.10` for
10%); when blank, the workspace default commission rate is used. This runs for
policy assignments made in the CRM frontend as well as policies written through
Protecta's backend. The policy's assigned agent and commission are linked to
existing People and Commission records.

Protecta is a **Twenty app**, not a separate Docker container or a replacement
for the Twenty homepage. `start.sh` builds and syncs `app/` into a Twenty
workspace. A healthy Twenty server alone does **not** mean Protecta is installed.

## One command on a fresh VPS

```bash
curl -fsSL https://raw.githubusercontent.com/Weareupsyd/twenty/main/protecta/install.sh | bash
```

Or, from a checkout you already have:

```bash
cd ~/twenty-fresh/protecta
./install.sh
```

### Production with Caddy — https://protectabode.weareupsyd.com

If you already pulled the repo:

```bash
cd protecta
./install.sh --with-caddy --with-evolution --domain protectabode.weareupsyd.com --email admin@weareupsyd.com
```

Or one-liner on a fresh VPS (no checkout needed):

```bash
curl -fsSL https://raw.githubusercontent.com/Weareupsyd/twenty/main/protecta/install.sh | bash -s -- --with-caddy --with-evolution --domain protectabode.weareupsyd.com --email admin@weareupsyd.com
```

What it does extra:
- Installs Caddy, writes `Caddyfile` for `protectabode.weareupsyd.com → localhost:2020` and `evolution.protectabode.weareupsyd.com → localhost:8080` with auto TLS
- The bare domain and any legacy `/admin` URL redirect to the public Protecta Bode site `/s/protecta/` — the domain never opens the CRM sign-in or a foreign admin panel; staff use `https://protectabode.weareupsyd.com/welcome`
- Sets `PUBLIC_BASE_URL=https://protectabode.weareupsyd.com` so quote/policy/WhatsApp links use the public domain
- Starts Evolution API + Caddy via `docker-compose.caddy.yml` with default webhook `https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook`
- Auto-registers webhook on Evolution instance `protecta` via `scripts/setup-evolution-webhook.sh`

DNS required before TLS works:
```
A  protectabode.weareupsyd.com           → YOUR_SERVER_IP
A  evolution.protectabode.weareupsyd.com → YOUR_SERVER_IP
```
Then open `https://protectabode.weareupsyd.com/s/protecta/` and `https://protectabode.weareupsyd.com/settings/whatsapp-bot` (main menu → WhatsApp bot).

See `EVOLUTION.md` for full Caddy + Evolution docs, manual webhook setup, and troubleshooting.

[`install.sh`](./install.sh) needs **git, curl and root (or sudo)** and then does the
whole chain without asking anything:

| Step | What it does |
| --- | --- |
| Source | When the script runs outside a checkout it clones `main` into `~/twenty-protecta` first; later runs update that checkout |
| Node 24 | Uses the system Node when it is 24.5+, re-runs under Node 24 through `npx` when it is older, and downloads Node 24 to `~/.twenty-node24` when Node is missing entirely |
| Docker | Installs it with the system package manager (`docker.io`, `docker`, `apk`, ...) when missing, then enables and starts the daemon |
| Dependencies | `npm ci` for `app/`, `docgen/app` and `sms/app`; when a lockfile no longer matches its `package.json`, it is repaired with `npm install` (with a warning) instead of stopping the install |
| Server | Starts Twenty in the `twenty-app-dev` container, including a slow first boot |
| API key | Reuses `TWENTY_API_KEY` or `.twenty-api-key`, otherwise mints one inside the container and saves it (chmod 600, git-ignored) |
| Apps | Syncs Document Generator, SMS Sender and Protecta Bode into the workspace |
| Verification | Checks that all three apps are registered in the workspace and prints the result |
| Caddy (if --with-caddy) | Installs Caddy, writes `/etc/caddy/Caddyfile` from `Caddyfile` template for `--domain` → `localhost:PORT` with auto TLS, sets `PUBLIC_BASE_URL=https://DOMAIN`; the domain root and legacy `/admin` redirect to `/s/protecta/` |
| Evolution (if --with-evolution) | Creates `.env.evolution`, starts `evolution-api` + `caddy` via `docker-compose.caddy.yml` with `WEBHOOK_GLOBAL_URL=https://DOMAIN/s/protecta/whatsapp/webhook`, auto-registers webhook |

| Flag | Meaning |
| --- | --- |
| `--port 3000` | Publish the server on another port (default 2020) |
| `--domain protectabode.weareupsyd.com` | Public domain for Caddy and PUBLIC_BASE_URL (default: protectabode.weareupsyd.com) |
| `--email admin@weareupsyd.com` | Email for Let's Encrypt TLS certs |
| `--with-caddy` | Install and configure Caddy reverse proxy for --domain with auto TLS |
| `--with-evolution` | Also run Evolution API (WhatsApp gateway) via docker-compose.caddy.yml with default webhook `https://DOMAIN/s/protecta/whatsapp/webhook` |
| `--evolution-domain evolution.protectabode.weareupsyd.com` | Evolution API subdomain (proxied to localhost:8080) |
| `--webhook-url https://.../s/protecta/whatsapp/webhook` | Override Evolution webhook URL (default: https://DOMAIN/s/protecta/whatsapp/webhook) |
| `--watch` | Keep watching `app/src` and re-sync after the install |
| `--branch <ref>` | Branch to clone in bootstrap mode (default `main`) |
| `--dir <path>` | Checkout to create/use in bootstrap mode (default `~/twenty-protecta`) |
| `--skip-prereqs` | Do not touch Node or Docker |
| `--no-verify` | Skip the post-install verification |
| `--reseed` | Re-run the Twenty dev seed before deploying (see step 3) |
| `--help` | List the options |

Re-running is safe: every step is idempotent, and existing data, containers and
keys are reused. `sudo` is only used for installing Docker and starting its
daemon. The sections below describe the same steps by hand, for when you want to
control each one.


## Start fresh safely: replace source, keep your workspace

If you only want the end result, use `./install.sh` above — the rest of this
section is the same procedure step by step, with explanations.

**Yes, you can clone fresh and rebuild. You do not need to delete the working
Twenty container or its database.** Use a new source directory first; keep your
old checkout until the new installation works.

| Item | What a fresh source checkout does |
| --- | --- |
| Source files, dependencies and build output | Recreated in the new directory |
| Running `twenty-app-dev` container | Reused by `start.sh` when healthy |
| Twenty database and Docker volumes | Kept; the app sync can still apply schema/data changes |
| CLI authentication under `~/.twenty/` | Kept; it is outside the source checkout |
| Installed Protecta app | Updated/synced into the selected workspace, not reset |

Back up the database and persistent storage before syncing if the workspace
contains important data. Keeping the old source directory is **not** a database
backup. These instructions do not rebuild the Twenty image from the monorepo;
they rebuild Protecta against the existing Twenty server.

### 1. Clone the source into a new folder

Run on the VPS:

```bash
cd ~
git clone --single-branch --branch main \
  https://github.com/Weareupsyd/twenty.git twenty-fresh
```

If your repair round published its own branch — they are named
`arena/<id>-twenty` — pass it instead with `--branch <ref>` (or
`git fetch origin <ref> && git checkout <ref>` on an existing checkout), and use
`--branch <ref>` with `install.sh` in bootstrap mode. If `~/twenty-fresh`
already exists, choose another unused directory and adjust the following paths.
Do not delete a folder just to make this command succeed.

### 2. Install dependencies and check the entire app

Prerequisites: Git, npm/npx, curl and a running Docker daemon. The pinned Twenty
SDK/client SDK 2.43 require **Node 24.5+ within Node 24**. Yarn is not required
for this procedure.

```bash
cd ~/twenty-fresh/protecta/app
npx --yes --package=node@24 -c 'npm ci --no-audit --no-fund && npm run check'
```

The Node 24 wrapper affects this command and its children only; it does not
replace system Node or change other VPS applications. `./start.sh` does not need
it: it re-runs itself under Node 24 when the system Node is older.

`npm run check` runs TypeScript, unit/handler tests, startup-script tests and the
actual SDK manifest/bundle build. It also checks referenced UI components and
queued workers. Build output is ignored under `app/.twenty/`.

**Stop if this step fails.** Do not continue to deployment with build errors.
These checks are offline: they do not prove successful database migrations or
real provider transactions.

### 3. Confirm Twenty is running

On the VPS:

```bash
curl -i --max-time 15 http://127.0.0.1:2020/healthz
```

Expect HTTP 200 and JSON containing `"status":"ok"`. If your existing server
is healthy, **leave it running** and continue to step 4.

**Only for a first installation with no Twenty server yet**, start the server
from the app directory:

```bash
cd ~/twenty-fresh/protecta/app
npx --yes --package=node@24 -c './node_modules/.bin/twenty docker:start --port 2020'
```

Initial seeding may outlast the CLI's three-minute wait. A reported timeout does
not necessarily mean the container stopped. Check the health endpoint again and
inspect logs before resetting anything:

```bash
docker ps -a
docker logs --tail 200 twenty-app-dev
```

Do not create another container if an existing one is merely still seeding.
`start.sh` also allows extra startup time when the container remains running.

**When the seed really did fail.** The watch printing
`Seeding workspace data... Failed` only means the three-minute look-out ended.
If the seed never finishes at all, the container still becomes healthy but holds
no workspace, and every API key is then rejected with
`You must be authenticated` — the key is not the problem. Ask the container what
it holds and repair it, without deleting anything:

```bash
cd ~/twenty-fresh/protecta
./create-api-key.sh --list     # workspaces, with their activation status
./start.sh --reseed            # re-run the dev seed, then deploy as usual
```

`start.sh` performs that check by itself before it mints a key, so a plain
re-run also recovers when the seed was the cause.

### 4. Get a workspace API key (no browser required)

The sync needs a **workspace API key** for the workspace Protecta is installed
into. On a headless VPS there are two ways to get one.

**Recommended: let the scripts do it.** `start.sh` mints a key inside the running
`twenty-app-dev` container through [`./create-api-key.sh`](./create-api-key.sh)
and saves it in `protecta/.twenty-api-key` (chmod 600, git-ignored). Later runs
reuse that file, so it only happens once. You can also drive it yourself:

| Command | What it does |
| --- | --- |
| `./create-api-key.sh` | Mint a key, verify it against the server, save it |
| `./create-api-key.sh --check` | Test `$TWENTY_API_KEY` or `.twenty-api-key` |
| `./create-api-key.sh --list` | List the workspaces inside the container |
| `./create-api-key.sh --workspace-id <uuid>` | Mint for a specific workspace |
| `./start.sh --new-api-key` | Rotate the key and deploy in one command |

The key is created with the workspace's Admin role, is named `protecta-cli`, and
can be revoked in **Settings → API keys**.

A key only works on the Twenty instance that issued it: a key from twenty.com or
from another VPS cannot authenticate against this container, and
`./create-api-key.sh --check` says so explicitly instead of starting an OAuth
prompt.

**Alternative: create the key in the browser.**

1. Open your working Twenty instance in your browser.
2. Select the workspace where Protecta should be installed.
3. Open **Settings → API keys** and create a key with the permissions needed to
   manage applications in that workspace, or reuse an existing valid key.
4. Copy the key. **Do not paste it in chat, source files or a README.**
5. Revoke any key previously exposed in chat or logs and create a replacement.

For an untouched development workspace, the seeded login is
`tim@apple.dev` / `tim@apple.dev`. Do not expose this development instance or its
seeded credentials publicly.

Use the same browser address you already use for the VPS. `localhost` in your
own browser means your own computer, not the VPS; use your configured HTTPS
address or an SSH tunnel. Do not open the firewall just to make a local OAuth
URL work.

### 5. Optional: hand a browser-made key to the scripts

This step is only for the browser path in step 4; `start.sh` looks after its own
keys otherwise.

**Do not paste this entire section at once.** The key must be pasted after the
prompt appears, not into the command itself.

First run:

```bash
cd ~/twenty-fresh/protecta
```

Then copy this command **exactly**, keeping the name `TWENTY_API_KEY` unchanged,
and press Enter:

```bash
read -r -s -p "PASTE YOUR API KEY HERE: " TWENTY_API_KEY; echo
```

Wait until the terminal displays:

```text
PASTE YOUR API KEY HERE:
```

**Now paste only the key and press Enter.** Nothing is displayed while you paste;
that is normal. Wait until the usual `root@...#` (or `$`) prompt returns.

Next run:

```bash
export TWENTY_API_KEY
```

Then check it without printing the secret:

```bash
if [ -n "$TWENTY_API_KEY" ]; then echo "API key is SET"; else echo "API key is EMPTY"; fi
```

- **SET:** continue to step 6.
- **EMPTY:** repeat the `read` command, wait for its prompt, paste the key and
  press Enter; then export and check again.

You can also save the key to the file `start.sh` reads, which survives a new SSH
session:

```bash
read -r -s -p "PASTE YOUR API KEY HERE: " K; echo
printf '%s\n' "$K" > .twenty-api-key && chmod 600 .twenty-api-key
./create-api-key.sh --check
```

`export` does not assign a key by itself. Do not replace the variable name with
the secret, and do not put the key after the closing quote in the `read` command.
The environment variable belongs to this shell; a new SSH session does not
preserve it, while `.twenty-api-key` does.

### 6. Sync Protecta from the same terminal

```bash
./start.sh
```

`start.sh` re-runs itself under Node 24 through `npx` when the system Node is
older, so the old `npx --yes --package=node@24 -c 'bash ./start.sh'` wrapper is
no longer required. Expect these stages:

1. Checking prerequisites / installing app dependencies.
2. Detecting the healthy Twenty server.
3. **Checking the workspace API key**, minting one if needed, then
   **authenticating remote 'protecta-local'**.
4. Syncing the Document Generator and SMS apps, then **syncing the app into the
   workspace**. Policy documents are generated from the Liberty "Motor Protecta
   Bode Policy" wording shipped with the Document Generator; schedule values
   come from the policy, policyholder and vehicle records (see
   [DEPLOYMENT.md](./DEPLOYMENT.md) for the fields and the premium-breakdown
   settings).
5. **Ready**, with `protecta-bode` shown as synced.

Do not assume installation succeeded until the sync finishes. If it fails, keep
the container and database intact and inspect the first error.

### 7. Refresh the same workspace in Twenty

Look for the insurance objects and navigation: quotes, policies, payments,
claims, vehicles, commissions, partner accounts, KYC and support tickets.
Open Settings → WhatsApp bot to connect the Evolution API instance. The
public calculator is at `/s/protecta/`. Protecta does not replace Twenty's
homepage.

The live page must be synced after a code change. On the VPS, from `protecta/`:

```bash
./start.sh
```

That republishes `/s/protecta/` with same-origin poster URLs. Until then the
page still points images at `localhost` and the key visual looks broken.

To use Ollama as a Twenty language model on this VPS, from `protecta/`:

```bash
./enable-ollama.sh --pull
./enable-ollama.sh --apply
```

That keeps the Twenty database and volumes, starts Ollama, and points the CRM
at it. Then open Settings → Admin panel → AI.

`--apply` is the step that actually turns Ollama on, and it is easy to skip:
without it the script only starts Ollama and prints the next command. Putting
both containers on one Docker network is also not enough on its own. The
network only makes Ollama *reachable*; Twenty has to be told the URL, and it
reads it from `OLLAMA_BASE_URL`, from an `AI_PROVIDERS` `ollama` entry, or from
a value saved under Settings → Admin panel → Config variables. A container
environment cannot be edited in place, which is why `--apply` recreates the
container. The admin-panel route needs no restart at all: the model registry
re-reads the LLM config group on the next request.

To find out which link is broken, run the read-only diagnostic:

```bash
./scripts/diagnose-ollama.sh
./scripts/diagnose-ollama.sh --model qwen2.5
```

It checks the Ollama daemon and its pulled models, the shared network, the base
URL Twenty actually resolves (including a database value overriding the
container environment), the `/v1` suffix, a real HTTP probe from inside the
Twenty container, the tier chains, and whether a model was switched off in the
admin panel. It changes nothing, and it ends by naming the first blocker with
the command that repairs it.

If nothing appears in Settings → Admin panel → AI once the diagnostic is clean,
confirm the sync completed, the browser is on the same workspace as the
deployment key, and your user has the appropriate permissions.

### Invoice and receipt documents

The customer-facing invoice and payment receipt are built from the black &
white document templates committed at the repository root
(`invoice-sample.html`, `receipt-sample.html`). Their layout, type scale and
rules are used as-is; the brand block is the Protecta Bode logo and every line
is live data — premium, quote reference, vehicle and plate, the payer's masked
number behind the Ugandan flag, the Stanbic account, and the support phone and
email from `SUPPORT_PHONE` / `SUPPORT_EMAIL`.

- The **invoice** is generated when a customer starts the pay flow
  (`generatePaymentInvoice`) and attached to the WhatsApp reply as before.
- The **receipt** is new: once an `insurancePayment` reaches `CONFIRMED`, the
  `deliver-payment-receipt` logic function sends the payer the receipt PDF on
  WhatsApp, once per payment (KV idempotency).

Both render through the Chromium HTML-to-PDF service so the CSS is what reaches
the customer:

```bash
docker compose --profile docgen-renderer -f docker-compose.caddy.yml up -d gotenberg
```

Set the endpoint with the `HTML_TO_PDF_URL` application variable (default
`http://gotenberg:3000/forms/chromium/convert/html`). When the renderer is not
running, both documents fall back to a drawn PDF so a payment or a WhatsApp
send never fails on missing infrastructure.

Live WhatsApp, payments and email still need provider configuration and smoke
tests. Follow [DEPLOYMENT.md](./DEPLOYMENT.md) before processing real traffic.

## Later starts and updates

Use the new checkout consistently; don't alternate between old and repaired
source trees.

```bash
cd ~/twenty-fresh
git pull --ff-only          # your checkout's branch; add "origin main" if you cloned main
cd protecta
./start.sh          # deploy the current source
# or, to redo prerequisites and the verification as well:
./install.sh
```

If Git reports local changes/conflicts, stop and review them; do not use a hard
reset to discard work. If the saved key was revoked, `./start.sh --new-api-key`
creates a replacement without a browser.

Node is handled for you: `start.sh` re-runs itself under Node 24 via `npx` when
the system Node is older (set `SKIP_NODE_BOOTSTRAP=1` to turn that off), so
`./start.sh` works even on a VPS whose system Node is 20.

| Task | Command from `protecta/` |
| --- | --- |
| Install or redo everything | `./install.sh` |
| Rebuild and sync | `./start.sh` |
| Refresh Caddy routing (domain root and `/admin` → Protecta landing) | `./scripts/setup-caddy.sh` (or `./install.sh --with-caddy`) |
| Sync one app on its own | `./twenty.sh sms` (also `app`, `docgen` or a path) |
| Sync and watch source changes | `./start.sh --watch` |
| Use a custom port | `./start.sh --port 3000` |
| Rotate the workspace API key | `./start.sh --new-api-key` |
| Repair a failed first-boot seed | `./start.sh --reseed` |
| Mint a key without deploying | `./create-api-key.sh` |
| Check a key | `./create-api-key.sh --check` |
| Enable local Ollama as a language model | `./enable-ollama.sh --pull --apply` |
| Find out why Ollama is not usable | `./scripts/diagnose-ollama.sh` (read-only) |
| Preview metadata changes | `app/node_modules/.bin/twenty plan app` |
| Server logs without Node/Yarn | `docker logs --tail 200 twenty-app-dev` |
| Server status | `app/node_modules/.bin/twenty docker:status` |
| Stop the development server | `app/node_modules/.bin/twenty docker:stop` |

Changing the source checkout does not change a running container's port mapping.
Investigate existing mappings before choosing another port; a wrong port is not
by itself a reason to erase the database.

### Environment

| Variable | Purpose |
| --- | --- |
| `TWENTY_API_KEY` | Workspace deployment key. Without it the script uses `.twenty-api-key`, mints a key in the container, reuses saved authentication, or falls back to interactive login. |
| `TWENTY_API_KEY_FILE` | Key file to read/write instead of `protecta/.twenty-api-key`. |
| `PKG_MANAGER` | `npm` for this lockfile-based setup, or `yarn` if deliberately selected. |
| `SKIP_INSTALL=1` | Skip dependency installation; use only when dependencies are already correct. |
| `SKIP_REMOTE=1` | Skip authentication/remote setup; use only when the correct remote is already selected. |
| `SKIP_NODE_BOOTSTRAP=1` | Don't re-run the script under Node 24 when the system Node is older. |

The workspace deployment key is **not** a Protecta partner API key, a Meta token,
or a payment-provider secret. Provider configuration is covered in
[DEPLOYMENT.md](./DEPLOYMENT.md).

## If you really want an empty database too

That is a **separate, destructive reset**, not a source rebuild. The SDK's
`docker:reset` operation deletes the local development volumes and their data.
It is not needed to fix build errors, dependency problems, authentication prompts
or the initial readiness timeout.

Before choosing it, back up and verify restore access for every workspace you
need to retain. Users, records, installed apps and API keys may need to be
recreated afterward. Do not use `docker system prune`, volume deletion or a
reset as part of the fresh-checkout procedure above.

## Notes

- `app/` is not a root monorepo workspace member. Install its dependencies from
  `protecta/app`, not by installing the entire repository at its root.
- `./twenty.sh app|docgen|sms` runs the CLI that belongs to that app
  (`<app>/node_modules/.bin/twenty`), installing the dependencies first when they
  are missing, and re-running under Node 24 when the system Node is older. A bare
  `npx twenty` is a different program: without `node_modules` npm resolves the
  name from the registry, finds the unrelated `twenty` package and fails with
  `could not determine executable to run` instead of saying the CLI is missing.
- Every app is installed with `npm ci`, so its `package-lock.json` has to match
  its `package.json`. `tests/lockfiles.test.sh` (part of `npm run check`) fails
  when one does not, and `start.sh`/`twenty.sh` repair a stale lockfile with
  `npm install` instead of aborting the deployment: `npm ci` would otherwise
  stop with ``can only install packages when your package.json and
  package-lock.json ... are in sync``. Commit the regenerated lockfile.
- `start.sh` starts/syncs this app; it does not build all of Twenty from source.
- Docker publishes port 2020 on all interfaces by default. Keep access restricted
  and use HTTPS/SSH tunneling as appropriate.
- Server image resolution follows `app/package.json`'s Twenty version range when
  the CLI starts a server. An already-running healthy container is reused;
  compatibility still needs to be checked during sync.
