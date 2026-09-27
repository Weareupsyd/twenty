/**
 * Repair the webhook ownership schema - the "once and for all" command behind
 * `npm run db:repair-webhooks`.
 *
 *   npm run db:repair-webhooks                 # apply the repair, print status
 *   npm run db:repair-webhooks -- --status     # inspect only, change nothing
 *   npm run db:repair-webhooks -- --print-sql  # print the DDL, no DB needed
 *
 * Same environment rules as `npm run migrate` (DATABASE_URL in
 * backend/.env or the process environment). This is what to run when the API
 * answers a webhook save with
 *
 *   insert or update on table "webhooks" violates foreign key constraint
 *   "webhooks_developer_id_fkey" (code 23503)
 *
 * and you want it fixed now rather than on the next deploy. The server applies
 * the identical repair at boot and on the first webhook write that looks like a
 * schema problem, so this script is for operators who want an explicit,
 * auditable action - and `--print-sql` is for a database this process cannot
 * reach (pipe it into psql, or run it in a Supabase SQL editor).
 *
 * It is deliberately the SAME code path the server uses: the SQL is imported
 * from services/webhookSchemaSql.ts, never copied here, so "repaired by the
 * script" and "repaired by the app" cannot mean different things.
 */

import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

const args = process.argv.slice(2);
const wantsSql = args.includes('--print-sql');
const wantsStatus = args.includes('--status');
const asJson = args.includes('--json');

if (wantsSql) {
  // No database adapter import on this path: printing the SQL must work
  // anywhere, including a host with no DATABASE_URL.
  const { WEBHOOK_OWNER_SCHEMA_SQL, WEBHOOK_DELIVERIES_SCHEMA_SQL } = await import(
    '../services/webhookSchemaSql.js'
  );
  console.log(
    [
      '-- Kabila webhook schema self-repair (identical to the repair the API applies at boot).',
      '-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f -',
      '-- Idempotent: safe to re-run; a migrated database is a no-op.',
      '',
      WEBHOOK_OWNER_SCHEMA_SQL,
      '',
      WEBHOOK_DELIVERIES_SCHEMA_SQL,
      '',
    ].join('\n')
  );
  process.exit(0);
}

if (!process.env.DATABASE_URL && !process.env.SUPABASE_URL) {
  console.error(
    ' DATABASE_URL is not set (and no SUPABASE_URL).\n\n' +
      '   Set it in backend/.env, exactly as for `npm run migrate`:\n' +
      '   DATABASE_URL=postgresql://user:pass@host:5432/dbname\n'
  );
  process.exit(1);
}

const {
  ensureWebhookOwnerSchema,
  resetWebhookSchemaHealState,
  readWebhookSchemaStatus,
} = await import('../services/webhookSchema.js');
const { supabase } = await import('../config/database.js');

function printStatus(status: Record<string, unknown>) {
  if (asJson) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  const yes = (v: unknown) => (v === true ? 'yes' : v === false ? 'NO' : String(v ?? '-'));
  console.log('  webhooks.owner_type present        ' + yes(status.has_owner_type));
  console.log('  webhooks.compliance_staff_id        ' + yes(status.has_compliance_staff_id));
  console.log('  webhooks.secret_key                 ' + yes(status.has_secret_key));
  console.log('  developer_id nullable               ' + yes(status.developer_id_nullable));
  console.log('  orphaned webhook rows               ' + String(status.orphaned_webhooks ?? '-'));
  const fks = Array.isArray(status.foreign_keys)
    ? status.foreign_keys
    : typeof status.foreign_keys === 'string'
      ? JSON.parse(status.foreign_keys)
      : [];
  for (const fk of fks as Array<{ constraint: string; references: string; validated: boolean }>) {
    const pointsAtPublicDevelopers = fk.references === 'public.developers';
    const flag =
      fk.constraint === 'webhooks_developer_id_fkey' && !pointsAtPublicDevelopers
        ? '   \u2190 STALE TARGET: this is what makes every webhook save fail 23503'
        : '';
    console.log(
      `  fk ${fk.constraint} -> ${fk.references} ${fk.validated ? '(validated)' : '(NOT VALID)'}${flag}`
    );
  }
}

try {
  if (wantsStatus) {
    console.log('Webhook schema status (no changes written):\n');
    printStatus(await readWebhookSchemaStatus());
    process.exit(0);
  }

  console.log('Repairing webhook ownership schema…\n');
  resetWebhookSchemaHealState();
  const result = await ensureWebhookOwnerSchema({ force: true });

  if (!result.applied) {
    if (result.reason === 'unsupported') {
      console.error(
        ' This database is reached through a Supabase client, which exposes no DDL path.\n' +
          '   Apply the same repair with:  npm run db:repair-webhooks -- --print-sql | psql "$DATABASE_URL" -f -\n' +
          '   or push the migrations:       supabase db push'
      );
      process.exit(1);
    }
    console.error(` Repair did not apply: ${result.message || 'unknown error'}`);
    process.exit(1);
  }

  console.log(' Webhook ownership + delivery schema converged.\n');
  console.log('Resulting shape:');
  printStatus(await readWebhookSchemaStatus());

  // Prove the repair is real rather than "no error thrown": read the table
  // back through the same client the API uses, the way the console does.
  const { data: sample, error: readError } = await (supabase as any)
    .from('webhooks')
    .select('id, url, owner_type, compliance_staff_id, api_key_id, is_sandbox, secret_key')
    .limit(1);
  if (readError) {
    console.error(` webhooks is still not readable after the repair: ${readError.message}`);
    process.exit(1);
  }
  console.log(
    `\n public.webhooks reads back through the API client (${sample?.length ?? 0} row(s) sampled). ` +
      'Webhook saves should now succeed; re-run with --status any time to re-check.'
  );
  process.exit(0);
} catch (err: any) {
  console.error(` ${err?.message || err}`);
  process.exit(1);
} finally {
  await (supabase as any)?.end?.();
}
