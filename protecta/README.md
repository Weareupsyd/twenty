# Protecta Bode

Motor insurance on Twenty CRM: 1.5% quotes, mobile-money payments, policies,
claims, a WhatsApp bot, and a partner API.

The app lives in [`app/`](./app) and is a **Twenty app** — it is not a
standalone server and has no process of its own. It is compiled and synced into a
running Twenty workspace by the `twenty` CLI. `start.sh` wires those steps up.

## Quick start

```bash
./start.sh
```

That will, in order: verify Node 20+ and a reachable Docker daemon, install the
app's dependencies, start the Twenty container, authenticate a CLI remote, and
sync the app into the workspace.

| | |
| --- | --- |
| Workspace | http://localhost:2020 |
| Login | `tim@apple.dev` / `tim@apple.dev` |
| Stop | `app/node_modules/.bin/twenty docker:stop` |
| Logs | `app/node_modules/.bin/twenty docker:logs -f` |
| Status | `app/node_modules/.bin/twenty docker:status` |

### Options

```bash
./start.sh --watch          # keep running, re-sync on every change to app/src
./start.sh --port 3000      # serve the workspace on a different port
./start.sh --help
```

### Environment

| Variable | Purpose |
| --- | --- |
| `TWENTY_API_KEY` | API key for the workspace. Required to run unattended; without it the script falls back to an interactive login. |
| `PKG_MANAGER` | `npm` (default) or `yarn`, for installing the app's dependencies. |
| `SKIP_INSTALL=1` | Don't touch `app/node_modules`. |
| `SKIP_REMOTE=1` | Don't (re)authenticate the CLI remote. |

To create a key: open the workspace, sign in with the credentials above, then
**Settings → API keys**.

## What to run when something changes

`./start.sh` is safe to re-run — it skips the server if it is already healthy,
reinstalls dependencies only when a manifest changed, and re-syncs the app. So
for most changes, just run it again:

```bash
./start.sh
```

More precisely:

| You changed | Run | Notes |
| --- | --- | --- |
| Anything under `app/src/` | `./start.sh` | Rebuilds and re-syncs metadata. |
| `app/package.json` or a lockfile | `./start.sh` | Detected automatically by mtime; reinstalls, then syncs. |
| `app/public/` (logos, icons) | `./start.sh` | |
| The workspace is stopped | `./start.sh` | Restarts the container, then syncs. |
| You want continuous rebuilds | `./start.sh --watch` | Watches `app/src/`; Ctrl-C to stop watching. |
| You only want to see what would change | `app/node_modules/.bin/twenty plan app` | Previews without applying. |
| You broke the workspace badly | `app/node_modules/.bin/twenty docker:reset` | Deletes all volumes and starts fresh. **Loses all local data.** |
| The port is wrong / container is stuck | `app/node_modules/.bin/twenty docker:reset` | The container name is reused, so a port change needs a reset first. |
| Auth expired or the key was rotated | `TWENTY_API_KEY=<new-key> ./start.sh` | Credentials live in `~/.twenty/config.json`. |

During active development, prefer `--watch`: it rebuilds on save, so you don't
have to re-run the script after every edit.

## Notes

- **`app/` is not a monorepo workspace member.** The twenty repo's root
  `workspaces.packages` is an explicit list of `packages/*` entries, so
  `yarn install` at the repo root does **not** install this app's dependencies.
  `start.sh` installs them separately.
- **The build needs `app/node_modules`.** The `twenty` CLI resolves `tsc` and
  `twenty-client-sdk` from the app's own `node_modules`, so a sync fails without
  that install.
- **Port 2020 is published on all interfaces.** Docker maps the port without a
  host bind, so the workspace is reachable from other machines. Firewall it if
  that is not intended.
- The Docker image version is resolved from the app's `engines.twenty` range, so
  the server matches what the app declares.
