/**
 * Webhook ownership self-heal - unit tests.
 *
 * Context: `POST /api/developer/webhooks` failed every save with
 *   insert or update on table "webhooks" violates foreign key constraint
 *   "webhooks_developer_id_fkey" (code 23503)
 * on databases where migrations 66/67/68 never ran, and AML/KYB dispatch
 * silently sent nothing because the reads filtered on an `owner_type` column
 * that did not exist. The fix is in-process schema provisioning (the pattern
 * Kuita has always used for its webhook store), so the contract under test here
 * is:
 *
 *   | Situation                                  | Behaviour                     |
 *   |--------------------------------------------|-------------------------------|
 *   | DDL-capable client (community PgClient)      | repair runs, memoised, retried |
 *   | no exec_sql (Supabase cloud)                 | no-op, reported `unsupported`  |
 *   | error is not schema-shaped                   | no repair, no retry            |
 *   | error is schema-shaped                       | repair once, then retry        |
 *   | the DDL itself                               | DDL-only + balanced quoting    |
 *   | ./scripts/repair-webhooks.sh                 | applies exactly this SQL       |
 *
 * The dollar-quote / exec_sql-allowlist assertions are not pedantry: the repair
 * is submitted through PgClient.rpc('exec_sql'), which rejects any statement it
 * does not recognise as DDL. A stray leading character in the template literal
 * silently turns every self-heal into a no-op - which is precisely the failure
 * class this module exists to eliminate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const rpcMock = vi.hoisted(() => vi.fn());
const hasRpc = vi.hoisted(() => ({ value: true }));

vi.mock('@/config/database.js', () => ({
  supabase: {
    // Present only when the test is standing in for the community PgClient.
    get rpc() {
      return hasRpc.value ? rpcMock : undefined;
    },
    pool: { query: vi.fn(async () => ({ rows: [] })) },
  },
  connectDB: vi.fn(),
}));

vi.mock('@/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logWebhookDelivery: vi.fn(),
}));

const {
  isWebhookSchemaError,
  ensureWebhookOwnerSchema,
  withWebhookSchemaHeal,
  resetWebhookSchemaHealState,
  WEBHOOK_OWNER_SCHEMA_SQL,
  WEBHOOK_DELIVERIES_SCHEMA_SQL,
} = await import('../webhookSchema.js');

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: null, error: null });
  hasRpc.value = true;
  resetWebhookSchemaHealState();
});

describe('isWebhookSchemaError', () => {
  it('classifies the schema-lag codes that justify a repair', () => {
    expect(isWebhookSchemaError({ code: '23503', message: 'violates foreign key constraint "webhooks_developer_id_fkey"' })).toBe(true);
    expect(isWebhookSchemaError({ code: '42703', message: 'column webhooks.owner_type does not exist' })).toBe(true);
    expect(isWebhookSchemaError({ code: '42P01', message: 'relation "public.webhook_deliveries" does not exist' })).toBe(true);
    expect(isWebhookSchemaError({ code: '42883', message: 'function uuid_generate_v4() does not exist' })).toBe(true);
  });

  it('leaves caller errors alone', () => {
    // A duplicate or an RLS denial is a real answer about THIS request; re-running
    // DDL for it would be wasted work at best and a lock-contention storm at worst.
    expect(isWebhookSchemaError({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(false);
    expect(isWebhookSchemaError({ code: '42501', message: 'new row violates row-level security policy' })).toBe(false);
    expect(isWebhookSchemaError({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })).toBe(false);
    expect(isWebhookSchemaError(null)).toBe(false);
    expect(isWebhookSchemaError(undefined)).toBe(false);
  });
});

describe('the repair SQL itself', () => {
  it('is accepted by the exec_sql DDL allowlist', () => {
    // Mirrors PgClient.rpc('exec_sql') ALLOWED_PREFIXES.
    for (const sql of [WEBHOOK_OWNER_SCHEMA_SQL, WEBHOOK_DELIVERIES_SCHEMA_SQL]) {
      const trimmed = sql.trimStart().toUpperCase();
      expect(['CREATE', 'ALTER', 'DROP', 'DO ', 'DO$'].some((p) => trimmed.startsWith(p))).toBe(true);
    }
  });

  it('is one atomic DO block with balanced dollar quoting', () => {
    for (const [name, sql] of Object.entries({
      ownership: WEBHOOK_OWNER_SCHEMA_SQL,
      deliveries: WEBHOOK_DELIVERIES_SCHEMA_SQL,
    })) {
      const tags = sql.match(/\$[a-z_]+\$/g) ?? [];
      // exactly open + close per block, plus nested blocks are forbidden here
      expect(tags.length % 2, `${name}: unbalanced dollar quotes`).toBe(0);
      const opens = tags.filter((t, i) => i % 2 === 0);
      const closes = tags.filter((_, i) => i % 2 === 1);
      opens.forEach((tag, i) => expect(closes[i]).toBe(tag));
      expect(sql.trimEnd().endsWith(';'), `${name}: must end with ;`).toBe(true);
      // The client sends the whole string as one query, so no statement may
      // follow the block (that would run outside the block's error handling).
      expect((sql.match(/^DO \$/gm) ?? []).length, `${name}: expected a single DO block`).toBe(1);
    }
  });

  it('repairs every failure class the incident produced', () => {
    const sql = WEBHOOK_OWNER_SCHEMA_SQL;
    expect(sql).toContain("REFERENCES public.developers(id)");
    expect(sql).toContain('ALTER COLUMN developer_id DROP NOT NULL');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS owner_type');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS compliance_staff_id');
    expect(sql).toContain('webhooks_owner_check');
    // never destroys operator data to satisfy a constraint
    expect(sql.toLowerCase()).not.toContain('delete from public.webhooks');
    expect(sql.toLowerCase()).not.toContain('drop table');
    // Supabase-only statements must be conditional: an unconditional CREATE
    // POLICY TO authenticated aborted migration 68 on stock Postgres, which is
    // how this whole class of outage started.
    const rlsAt = sql.indexOf("rolname = 'authenticated'");
    const firstPolicy = sql.indexOf('CREATE POLICY');
    expect(rlsAt).toBeGreaterThan(-1);
    expect(firstPolicy).toBeGreaterThan(rlsAt);
  });
});

describe('ensureWebhookOwnerSchema', () => {
  it('runs the DDL through exec_sql and memoises success', async () => {
    expect((await ensureWebhookOwnerSchema()).applied).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(2);   // ownership + deliveries
    expect(rpcMock.mock.calls[0][0]).toBe('exec_sql');

    await ensureWebhookOwnerSchema();
    expect(rpcMock).toHaveBeenCalledTimes(2);    // still: one repair per process

    await ensureWebhookOwnerSchema({ force: true });
    expect(rpcMock).toHaveBeenCalledTimes(4);    // force re-runs both blocks
  });

  it('reports unsupported without a usable exec_sql, and never throws', async () => {
    hasRpc.value = false;                        // real Supabase client shape
    const result = await ensureWebhookOwnerSchema();
    expect(result).toEqual({ applied: false, reason: 'unsupported' });
  });

  it('treats "exec_sql does not exist" as Supabase-managed, not as a failure', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Could not find the function public.exec_sql(sql) in the schema cache' },
    });
    const result = await ensureWebhookOwnerSchema();
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('unsupported');
  });

  it('surfaces a genuine DDL failure for the operator, without throwing', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: '42501', message: 'must be owner of table webhooks' } });
    const result = await ensureWebhookOwnerSchema();
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('failed');
    expect(result.message).toMatch(/must be owner of table webhooks/);
  });

  it('coalesces concurrent triggers into one pass', async () => {
    await Promise.all([
      ensureWebhookOwnerSchema(),
      ensureWebhookOwnerSchema(),
      ensureWebhookOwnerSchema(),
    ]);
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });
});

describe('withWebhookSchemaHeal', () => {
  it('passes a clean result straight through', async () => {
    const operation = vi.fn(async () => ({ data: [{ id: 'w1' }], error: null }));
    const { result, healed } = await withWebhookSchemaHeal(operation, { label: 'test' });
    expect(healed).toBe(false);
    expect(result.data).toEqual([{ id: 'w1' }]);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('does not repair for a caller error (duplicate / RLS)', async () => {
    const failure = { data: null, error: { code: '23505', message: 'duplicate key value' } };
    const operation = vi.fn(async () => failure);
    const { result, healed } = await withWebhookSchemaHeal(operation, { label: 'test' });
    expect(healed).toBe(false);
    expect(result).toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('repairs and retries once on the 23503 from the incident', async () => {
    const operation = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: '23503', message: 'insert or update on table "webhooks" violates foreign key constraint "webhooks_developer_id_fkey"' },
      })
      .mockResolvedValueOnce({ data: { id: 'created' }, error: null });

    const { result, healed } = await withWebhookSchemaHeal(operation, { label: 'webhook-create' });
    expect(healed).toBe(true);
    expect(result.data).toEqual({ id: 'created' });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(rpcMock).toHaveBeenCalled();
  });

  it('does not retry when the repair cannot run (Supabase-managed schema)', async () => {
    hasRpc.value = false;
    const failure = { data: null, error: { code: '42703', message: 'column webhooks.owner_type does not exist' } };
    const operation = vi.fn(async () => failure);
    const { result, healed } = await withWebhookSchemaHeal(operation, { label: 'test' });
    expect(healed).toBe(false);
    expect(result).toBe(failure);
    // One attempt: no pointless second round-trip against a schema we may not touch.
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('reports the surviving error when the repair ran but did not help', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'must be owner of table webhooks' } });
    const failure = { data: null, error: { code: '23503', message: 'violates foreign key constraint "webhooks_developer_id_fkey"' } };
    const operation = vi.fn(async () => failure);
    const { result, healed } = await withWebhookSchemaHeal(operation, { label: 'test' });
    expect(healed).toBe(false);
    expect(result).toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe('drift guard: scripts/repair-webhooks.sh', () => {
  const scriptPath = join(__dirname, '..', '..', '..', '..', '..', 'scripts', 'repair-webhooks.sh');

  it('applies exactly the SQL the app applies', () => {
    // The host-side repair (the "fix the running instance without a rebuild"
    // command) prints the SQL it pipes into psql by extracting these two
    // constants out of webhookSchemaSql.ts. If the extraction ever stops
    // matching - a renamed constant, a reformatted template literal - the
    // script would silently repair a different, older shape than the app does.
    if (!existsSync(scriptPath)) return;   // partial checkout / image build

    let printed: string;
    try {
      printed = execFileSync('bash', [scriptPath, '--print'], { encoding: 'utf8' });
    } catch (err: any) {
      if (String(err?.message).includes('ENOENT')) return;   // no bash on this runner
      throw err;
    }

    const collapse = (text: string) =>
      text.replace(/\r\n/g, '\n').replace(/\n{2,}/g, '\n').trim();

    expect(collapse(printed)).toBe(
      collapse([WEBHOOK_OWNER_SCHEMA_SQL, WEBHOOK_DELIVERIES_SCHEMA_SQL].join('\n'))
    );
  });
});
