# Unified migrations

Sequential SQL, applied at API boot by `backend/docker-entrypoint.sh` through
`backend/src/scripts/migrate.ts`. Successful filenames are recorded in
`public._migrations`; changing an already-applied file does not replay it.

| File | What |
|---|---|
| `0001_schemas.sql` | `aml` + `compliance` schemas |
| `0002_staff.sql` | Merged console operators (`compliance.staff`) |
| `0003_decisions.sql` | Unified approve / reject / escalate |
| `0004_subject_links.sql` | Subject identity + KYB UBO fan-out |
| `0005_api_key_scopes.sql` | `api_keys.scopes` (no-op until Kabila has created the table) |
| `0006_phase3.sql` | `subject_links.display_ref` + `generated_reports` |
| `0007_phase4.sql` | Dual-write columns/triggers + historical backfill |
| `0008_phase5.sql` | Cutover journal (`migration_runs` phase 5) |
| `0009_system_settings.sql` | `aml.system_settings` (thresholds + corridor overrides) |
| `0010_hosted_page_launcher.sql` | Server-only hosted-page account/key so a fresh install can launch tokenized QR sessions |
| `0011_aml_core_tables.sql` | Ported `aml.*` tables (`screening_requests`, `dataset_syncs`, `cases`, `case_notes`, local enrichment) + hosted-pages column guards |
| `0012_public_core_tables.sql` | Self-healing `public.developers` + `public.api_keys` (console + hosted pages + developer portal surface) |
| `0013_public_verification_tables.sql` | Self-healing KYC subject + verification tables (`users`, `verification_requests`, `documents`, `selfies`, `verification_contexts`) |
| `0014_mobile_handoff_sessions.sql` | Self-healing `public.mobile_handoff_sessions` (desktop -> phone QR handoff; fixes the `POST /api/verify/handoff/create` 500 -> "Could not generate QR code") |
| `0015_verification_addons.sql` | Add `verification_requests.addons` to existing tables (the `CREATE TABLE IF NOT EXISTS` in 0013 only handles absent tables); mirrors core migration 70 |

Kabila first applies `supabase/migrations/` into `public`, then this directory.
The add-ons repair is intentionally present in both migration sets so core-only
and compliance-fallback deployments can upgrade without losing data. Both use
`ADD COLUMN IF NOT EXISTS`; neither overwrites existing add-on values.
AML tables live in the `aml` schema (created by the TS port / leftover SQLAlchemy on older volumes).

`public.users` remains **KYC subjects**. Staff never land there.

## Regression tests

From `kyc-stack/`, after installing dependencies and building shared:

```bash
npm run build --workspace shared
npm test --workspace backend -- --run src/routes/__tests__/health.readiness.test.ts
# Set KYC_TEST_DATABASE_URL to a PostgreSQL TEST server with CREATEDB permission.
npm test --workspace backend -- --run src/scripts/__tests__/verificationAddons.migration.test.ts
```

The PostgreSQL tests are skipped unless `KYC_TEST_DATABASE_URL` is set. They
create/drop randomly named databases (never the supplied database), run the real
migration runner, reproduce the pre-fix `42703`/500, and exercise authenticated
initialization, readiness, upgrade preservation, and replay safety. No Docker or
ML worker is needed for these initialization-only tests.
