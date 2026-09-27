/**
 * Webhook ownership schema - self-provisioning, like Kuita's webhook store.
 *
 * Kuita (`KYC_bundle/new/kuita-master/cmd/server/webhookstore.go`) never
 * depends on an out-of-band schema step: `newWebhookStore()` runs its own
 * idempotent `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
 * statements before the process serves a single request, so webhook endpoints
 * and the delivery log exist on every database, on every deploy, in every
 * mode. There is no window where "the app is newer than the schema".
 *
 * Kabila's webhooks table could not do that, and paid for it:
 *
 *   insert or update on table "webhooks" violates foreign key
 *   constraint "webhooks_developer_id_fkey" (code 23503)
 *
 * Three independent causes, all real, all reported in production:
 *
 *   1. STALE FK TARGET. `01_initial_schema.sql` wrote an unqualified
 *      `REFERENCES developers(id)`. PostgreSQL binds a foreign key to the
 *      target *OID* at creation time, so on a database that once had a
 *      non-public `developers` table the constraint keeps pointing at that
 *      legacy relation forever - even though the API authenticates the
 *      developer from public.developers. Authentication succeeds, the INSERT
 *      then fails 23503 against a table nobody reads.
 *   2. MISSING COLUMNS. `owner_type` / `compliance_staff_id` (AML staff
 *      webhooks), `secret_key` / `events` / `api_key_id` - present in
 *      supabase/migrations, absent in databases provisioned from
 *      `src/sql/schema.sql`, which uses a *different* webhooks shape
 *      (`developer_id NOT NULL`, `secret_token`, no `events`). Reads and
 *      writes on those columns fail with 42703.
 *   3. MIGRATIONS THAT NEVER RAN. The image only auto-migrates when
 *      `MIGRATIONS_DIR` exists, and that directory has always been a
 *      docker-compose bind mount (`supabase/migrations` is in .dockerignore),
 *      so a host that runs the image without that mount - or any migration
 *      the boot runner skipped under `MIGRATIONS_LENIENT=true` - lands on a
 *      database stuck at whatever shape it was created in. Migrations 66/67/68
 *      then never apply, and the portal answers "run npm run migrate" on
 *      every webhook save, forever.
 *
 * This module closes all three the way Kuita does: the API owns the webhook
 * schema and converges it at startup, and again lazily on the first webhook
 * write that looks like a schema problem. It is DDL-only and idempotent -
 * safe to run on every boot, on a fully-migrated database (where it is a
 * no-op), and on a database with historical junk rows (orphans keep their
 * rows; the constraint is left NOT VALID and reported).
 *
 * Mode behaviour:
 *   - Community / stock Postgres (`DATABASE_URL` -> PgClient): executes via the
 *     `exec_sql` RPC, which is DDL-only by construction.
 *   - Supabase cloud: no `exec_sql`, so this reports `unsupported` and stays
 *     out of the way - schema there belongs to `supabase db push` / the
 *     migration files. Nothing throws either way; a failed heal downgrades the
 *     request to the actionable 400 it used to be, never to a 500.
 */

import { supabase } from '@/config/database.js';
import { logger } from '@/utils/logger.js';
// The DDL itself lives in a dependency-free module: `npm run
// db:repair-webhooks -- --print-sql` has to be able to print it on a host with
// no DATABASE_URL, where importing the database adapter would throw. Re-exported
// here so callers have one import site.
import { WEBHOOK_OWNER_SCHEMA_SQL, WEBHOOK_DELIVERIES_SCHEMA_SQL } from './webhookSchemaSql.js';

export { WEBHOOK_OWNER_SCHEMA_SQL, WEBHOOK_DELIVERIES_SCHEMA_SQL };

export type WebhookSchemaRepairResult = {
  /** True when the DDL actually ran against this database. */
  applied: boolean;
  /** `unsupported` = no exec_sql (Supabase cloud); `failed` = DDL errored. */
  reason?: 'unsupported' | 'failed';
  message?: string;
};

let repaired = false;
let repairInFlight: Promise<WebhookSchemaRepairResult> | null = null;

/** Does the database let this process run DDL at all? */
function canExecDdl(client: any): boolean {
  return !!client && typeof client.rpc === 'function';
}

async function runDdl(sql: string): Promise<WebhookSchemaRepairResult> {
  const client: any = supabase;
  if (!canExecDdl(client)) {
    return { applied: false, reason: 'unsupported', message: 'exec_sql unavailable' };
  }
  try {
    const { error } = await client.rpc('exec_sql', { sql });
    if (error) {
      // 42883 "function exec_sql(...) does not exist" is the Supabase-cloud
      // case - the schema there is managed by `supabase db push`, so a
      // missing RPC is expected and must never surface to a user.
      if (
        typeof error.message === 'string' &&
        /does not exist|function .*exec_sql/i.test(error.message) &&
        (error.code === undefined || error.code === '42883')
      ) {
        return { applied: false, reason: 'unsupported', message: error.message };
      }
      return { applied: false, reason: 'failed', message: error.message };
    }
    return { applied: true };
  } catch (err: any) {
    return { applied: false, reason: 'failed', message: err?.message };
  }
}

/**
 * Repair the webhook ownership schema. Memoised: the first webhook write of
 * the process pays for it, everything after that is a boolean check. `force`
 * re-runs it after a schema-shaped failure, which is how a database fixed
 * out-of-band between requests is picked up without a restart.
 *
 * Never throws. Callers treat `applied: false` as "carry on and map the error",
 * not as a new failure mode.
 */
export async function ensureWebhookOwnerSchema(
  opts: { force?: boolean } = {}
): Promise<WebhookSchemaRepairResult> {
  if (repaired && !opts.force) return { applied: true };

  // Coalesce concurrent triggers (boot + the first few portal requests) into
  // one DDL pass - two simultaneous ALTER TABLEs would block each other on
  // ACCESS EXCLUSIVE for no reason.
  if (repairInFlight) {
    const inFlight = repairInFlight;
    const result = await inFlight;
    return opts.force && !result.applied ? repairWebhookOwnerSchemaNow() : result;
  }

  repairInFlight = repairWebhookOwnerSchemaNow().then((result) => {
    repairInFlight = null;
    return result;
  });
  return repairInFlight;
}

async function repairWebhookOwnerSchemaNow(): Promise<WebhookSchemaRepairResult> {
  const ownership = await runDdl(WEBHOOK_OWNER_SCHEMA_SQL);
  const deliveries = await runDdl(WEBHOOK_DELIVERIES_SCHEMA_SQL);

  if (ownership.applied) repaired = true;

  if (ownership.reason === 'unsupported' && deliveries.reason === 'unsupported') {
    logger.debug?.('webhook schema self-heal unsupported on this database (Supabase-managed schema)');
    return { applied: false, reason: 'unsupported' };
  }
  if (!ownership.applied) {
    logger.warn('webhook schema self-heal did not apply', {
      reason: ownership.reason,
      message: ownership.message,
    });
    return ownership;
  }
  if (!deliveries.applied) {
    logger.warn('webhook delivery log self-heal did not apply', {
      reason: deliveries.reason,
      message: deliveries.message,
    });
  }
  logger.info('Webhook ownership schema verified (self-heal)');
  return { applied: true };
}

/** Reset the memo - used by tests and by the repair CLI. */
export function resetWebhookSchemaHealState(): void {
  repaired = false;
  repairInFlight = null;
}

/**
 * Is this Postgres error "the schema is behind the code" rather than "this
 * request is invalid"? Only these justify a repair-and-retry.
 *
 *   23503 FK violation      -> stale/incorrect ownership FK
 *   42703 undefined column  -> owner_type / secret_key / events / api_key_id
 *   42P01 undefined table    -> webhooks or webhook_deliveries never created
 *   42883 undefined function -> uuid-ossp / auth.uid() absent
 *   42846 datatype mismatch  -> legacy column typed differently
 */
export function isWebhookSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code && ['23503', '42703', '42P01', '42883', '42846'].includes(error.code)) return true;
  const msg = (error.message || '').toLowerCase();
  return (
    msg.includes('foreign key constraint') ||
    msg.includes('does not exist') ||
    msg.includes('schema cache')
  );
}

/**
 * Run a webhook read/write, self-healing once on a schema-shaped failure.
 *
 * This is the whole point of the module: the repair is not a deploy-time
 * lottery that the operator has to notice. A request that hits a database
 * which never received migrations 66/67/68 fixes the database and completes,
 * and only a *second* failure - after the repair ran - is reported.
 */
export async function withWebhookSchemaHeal<T>(
  operation: () => Promise<T>,
  opts: { retryWhen?: (result: T) => any; label?: string } = {}
): Promise<{ result: T; healed: boolean }> {
  const first = await operation();
  const error = opts.retryWhen ? opts.retryWhen(first) : (first as any)?.error;
  if (!error || !isWebhookSchemaError(error)) {
    return { result: first, healed: false };
  }

  logger.warn('Webhook operation hit a schema problem - self-healing and retrying once', {
    label: opts.label,
    code: (error as any).code,
    message: (error as any).message,
  });

  const repair = await ensureWebhookOwnerSchema({ force: true });
  if (!repair.applied) {
    return { result: first, healed: false };
  }

  return { result: await operation(), healed: true };
}

/**
 * Diagnostic snapshot for `npm run db:repair-webhooks -- --status`: what is
 * actually bound right now, which is the question an operator asks when a
 * 23503 comes back after a "successful" migrate.
 */
export async function readWebhookSchemaStatus(): Promise<Record<string, unknown>> {
  const client: any = supabase;
  if (!client?.pool?.query) {
    return { mode: 'supabase', note: 'status inspection needs DATABASE_URL (community mode)' };
  }

  const { rows } = await client.pool.query(`
    SELECT
      (SELECT COUNT(*) FROM pg_catalog.pg_attribute
        WHERE attrelid = 'public.webhooks'::regclass AND attname = 'owner_type' AND NOT attisdropped) > 0
        AS has_owner_type,
      (SELECT COUNT(*) FROM pg_catalog.pg_attribute
        WHERE attrelid = 'public.webhooks'::regclass AND attname = 'compliance_staff_id' AND NOT attisdropped) > 0
        AS has_compliance_staff_id,
      (SELECT COUNT(*) FROM pg_catalog.pg_attribute
        WHERE attrelid = 'public.webhooks'::regclass AND attname = 'secret_key' AND NOT attisdropped) > 0
        AS has_secret_key,
      (SELECT NOT a.attnotnull FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = 'public.webhooks'::regclass AND a.attname = 'developer_id') AS developer_id_nullable,
      COALESCE((
        SELECT json_agg(json_build_object(
          'constraint', c.conname,
          'references', (c.confrelid::regclass)::text,
          'validated', c.convalidated
        ))
        FROM pg_catalog.pg_constraint c
        WHERE c.conrelid = 'public.webhooks'::regclass AND c.contype = 'f'
      ), '[]'::json) AS foreign_keys,
      (SELECT COUNT(*) FROM public.webhooks w
        LEFT JOIN public.developers d ON d.id = w.developer_id
       WHERE w.developer_id IS NOT NULL AND d.id IS NULL) AS orphaned_webhooks
    WHERE to_regclass('public.webhooks') IS NOT NULL
  `);

  return rows[0] ?? { note: 'public.webhooks does not exist yet - the self-heal will create it' };
}
