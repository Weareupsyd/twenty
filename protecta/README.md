# Protecta Bode

Motor insurance on Twenty CRM: 1.5% quotes, mobile-money payments, policies,
claims, a WhatsApp bot, and a partner API.

Protecta is a **Twenty app**, not a separate Docker container or a replacement
for the Twenty homepage. `start.sh` builds and syncs `app/` into a Twenty
workspace. A healthy Twenty server alone does **not** mean Protecta is installed.

## Start fresh safely: replace source, keep your workspace

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

### 1. Clone the repaired branch into a new folder

Run on the VPS:

```bash
cd ~
git clone --single-branch --branch arena/01a0e3bb-twenty \
  https://github.com/Weareupsyd/twenty.git twenty-fresh
```

**Use that branch explicitly.** The repair and these instructions are published
on `arena/01a0e3bb-twenty`; a default clone of `main` may not contain them yet.
If `~/twenty-fresh` already exists, choose another unused directory and adjust
the following paths. Do not delete a folder just to make this command succeed.

### 2. Install dependencies and check the entire app

Prerequisites: Git, npm/npx, curl and a running Docker daemon. The pinned Twenty
SDK/client SDK 2.43 require **Node 24.5+ within Node 24**. Yarn is not required
for this procedure.

```bash
cd ~/twenty-fresh/protecta/app
npx --yes --package=node@24 -c 'npm ci --no-audit --no-fund && npm run check'
```

The Node 24 wrapper affects this command and its children only; it does not
replace system Node or change other VPS applications.

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

### 4. Create or select the workspace API key in Twenty

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

### 5. Enter the API key in the terminal — one step at a time

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

`export` does not assign a key by itself. Do not replace the variable name with
the secret, and do not put the key after the closing quote in the `read` command.
This environment variable belongs to this shell; opening a new SSH session does
not preserve it. The CLI can separately retain authenticated remote credentials
under `~/.twenty/` after a successful login.

### 6. Sync Protecta from the same terminal

```bash
npx --yes --package=node@24 -c 'bash ./start.sh'
```

With the exported key, expect these stages:

1. Checking prerequisites / installing app dependencies.
2. Detecting the healthy Twenty server.
3. **Authenticating remote 'protecta-local'** via API key.
4. **Syncing app into the workspace**.
5. **Ready**, with `protecta-bode` shown as synced.

Do not assume installation succeeded until the sync finishes. If it fails, keep
the container and database intact and inspect the first error.

### 7. Refresh the same workspace in Twenty

Look for the insurance objects and navigation: quotes, policies, payments,
claims, vehicles, commissions, partner accounts, KYC and support tickets.
Check the Protecta Bode settings entry as well. Protecta does not necessarily
replace Twenty's homepage with a branded screen.

If nothing appears, confirm the sync completed, the browser is on the same
workspace as the deployment key, and your user has the appropriate permissions.

Live WhatsApp, payments and email still need provider configuration and smoke
tests. Follow [DEPLOYMENT.md](./DEPLOYMENT.md) before processing real traffic.

## Later starts and updates

Use the new checkout consistently; don't alternate between old and repaired
source trees.

```bash
cd ~/twenty-fresh
git pull --ff-only origin arena/01a0e3bb-twenty
cd protecta
npx --yes --package=node@24 -c 'bash ./start.sh'
```

If Git reports local changes/conflicts, stop and review them; do not use a hard
reset to discard work. If authentication expired, repeat step 5 with a valid key.

With Node 24.5+ already active in your shell, you can run `./start.sh` directly.

| Task | Command from `protecta/` with supported Node active |
| --- | --- |
| Rebuild and sync | `./start.sh` |
| Sync and watch source changes | `./start.sh --watch` |
| Use a custom port | `./start.sh --port 3000` |
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
| `TWENTY_API_KEY` | Workspace deployment key; enter it using the hidden prompt above. Without it the script tries saved authentication, then interactive login. |
| `PKG_MANAGER` | `npm` for this lockfile-based setup, or `yarn` if deliberately selected. |
| `SKIP_INSTALL=1` | Skip dependency installation; use only when dependencies are already correct. |
| `SKIP_REMOTE=1` | Skip authentication/remote setup; use only when the correct remote is already selected. |

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
- `start.sh` starts/syncs this app; it does not build all of Twenty from source.
- Docker publishes port 2020 on all interfaces by default. Keep access restricted
  and use HTTPS/SSH tunneling as appropriate.
- Server image resolution follows `app/package.json`'s Twenty version range when
  the CLI starts a server. An already-running healthy container is reused;
  compatibility still needs to be checked during sync.
