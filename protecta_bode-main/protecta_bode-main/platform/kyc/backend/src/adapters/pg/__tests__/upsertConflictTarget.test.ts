/**
 * Regression: composite ON CONFLICT targets in the Supabase-compatible
 * Postgres adapter.
 *
 * Supabase accepts a composite conflict target as a comma-separated string,
 * `{ onConflict: 'developer_id,workflow_id' }`. The adapter quoted the whole
 * string, producing:
 *
 *     ON CONFLICT ("developer_id,workflow_id")
 *
 * which Postgres reads as a single column with a comma in its name and rejects
 * with `column "developer_id,workflow_id" does not exist`. Every upsert against
 * a composite unique constraint returned a 500.
 *
 * It went unnoticed because nothing in the codebase used a composite conflict
 * target until kyb_workflows, and the adapter had no tests. These assert on the
 * generated SQL, which is where the bug actually lived.
 */

import { describe, it, expect, vi } from 'vitest';
import { PgQueryBuilder } from '../PgQueryBuilder.js';

/** Capture the SQL the builder produces without needing a live database. */
function captureSql() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows: [{ id: 'row-1' }], rowCount: 1 };
    }),
  };
  return { pool: pool as never, calls };
}

describe('upsert conflict target', () => {
  it('quotes each column of a composite target separately', async () => {
    const { pool, calls } = captureSql();
    await new PgQueryBuilder(pool, 'kyb_workflows')
      .upsert(
        { developer_id: 'dev-1', workflow_id: 'wf_ke', nested_ownership_enabled: true },
        { onConflict: 'developer_id,workflow_id' },
      );

    const { sql } = calls[0];
    expect(sql).toContain('ON CONFLICT ("developer_id", "workflow_id")');
    // The exact shape that made Postgres reject the statement.
    expect(sql).not.toContain('"developer_id,workflow_id"');
  });

  it('still handles a single-column target', async () => {
    const { pool, calls } = captureSql();
    await new PgQueryBuilder(pool, 'widgets').upsert({ id: 'w1', name: 'x' }, { onConflict: 'id' });
    expect(calls[0].sql).toContain('ON CONFLICT ("id")');
  });

  it('defaults to id when no target is given', async () => {
    const { pool, calls } = captureSql();
    await new PgQueryBuilder(pool, 'widgets').upsert({ id: 'w1', name: 'x' });
    expect(calls[0].sql).toContain('ON CONFLICT ("id")');
  });

  it('tolerates spaces around the comma', async () => {
    const { pool, calls } = captureSql();
    await new PgQueryBuilder(pool, 'kyb_workflows')
      .upsert({ developer_id: 'd', workflow_id: 'w', name: 'n' }, { onConflict: 'developer_id, workflow_id' });
    expect(calls[0].sql).toContain('ON CONFLICT ("developer_id", "workflow_id")');
  });

  it('excludes every conflict column from the DO UPDATE SET clause', async () => {
    // Assigning a conflict column to itself in the SET clause is redundant at
    // best; with a composite key the second column was previously included.
    const { pool, calls } = captureSql();
    await new PgQueryBuilder(pool, 'kyb_workflows')
      .upsert(
        { developer_id: 'd', workflow_id: 'w', nested_ownership_enabled: true },
        { onConflict: 'developer_id,workflow_id' },
      );

    const { sql } = calls[0];
    const setClause = sql.slice(sql.indexOf('DO UPDATE SET'));
    expect(setClause).toContain('"nested_ownership_enabled" = EXCLUDED."nested_ownership_enabled"');
    expect(setClause).not.toContain('"developer_id" = EXCLUDED');
    expect(setClause).not.toContain('"workflow_id" = EXCLUDED');
  });

  it('falls back to DO NOTHING when every column is part of the key', async () => {
    const { pool, calls } = captureSql();
    await new PgQueryBuilder(pool, 'join_table')
      .upsert({ a: 1, b: 2 }, { onConflict: 'a,b' });
    expect(calls[0].sql).toContain('DO NOTHING');
  });

  it('sends an explicit null rather than dropping the column', async () => {
    // `nested_ownership_enabled: null` is a real instruction meaning "inherit
    // the deployment default". If it were dropped, saving Inherit would leave
    // the previous value in place.
    const { pool, calls } = captureSql();
    await new PgQueryBuilder(pool, 'kyb_workflows')
      .upsert(
        { developer_id: 'd', workflow_id: 'w', nested_ownership_enabled: null },
        { onConflict: 'developer_id,workflow_id' },
      );

    expect(calls[0].sql).toContain('"nested_ownership_enabled"');
    expect(calls[0].params).toContain(null);
  });
});

/**
 * Regression: the count query must not be given LIMIT/OFFSET parameters.
 *
 * `.select('*', { count: 'exact' }).range(a, b)` built the main query with
 * `$1..$n` for WHERE plus two more for LIMIT/OFFSET, then reused that same
 * parameter array for `SELECT COUNT(*)`, which has no LIMIT clause. Postgres
 * rejected it:
 *
 *   bind message supplies 3 parameters, but prepared statement "" requires 1
 *
 * Every paginated list that asks for an exact count hit this - including
 * GET /api/v2/business/sessions, which returned 500 against real Postgres.
 * It survived because the unit tests mock the database and only integration
 * against a real server binds parameters for real.
 */
describe('count query parameters', () => {
  it('passes only the WHERE parameters to COUNT, not LIMIT/OFFSET', async () => {
    const { pool, calls } = captureSql();
    await new PgQueryBuilder(pool, 'business_sessions')
      .select('*', { count: 'exact' })
      .eq('developer_id', 'dev-1')
      .is('parent_session_id', null)
      .range(0, 19);

    const main = calls.find(c => c.sql.startsWith('SELECT *'))!;
    const count = calls.find(c => c.sql.includes('COUNT(*)'))!;

    // Main query binds developer_id plus LIMIT and OFFSET.
    expect(main.sql).toContain('LIMIT');
    expect(main.params).toHaveLength(3);

    // The count query has no LIMIT, so it must bind only developer_id.
    // (`IS NULL` is inlined, not parameterised.)
    expect(count.sql).not.toContain('LIMIT');
    expect(count.params).toHaveLength(1);
    expect(count.params[0]).toBe('dev-1');
  });

  it('still counts correctly with no filters at all', async () => {
    const { pool, calls } = captureSql();
    await new PgQueryBuilder(pool, 'widgets').select('*', { count: 'exact' }).range(0, 9);
    const count = calls.find(c => c.sql.includes('COUNT(*)'))!;
    expect(count.params).toHaveLength(0);
  });

  it('does not run a count query when none was asked for', async () => {
    const { pool, calls } = captureSql();
    await new PgQueryBuilder(pool, 'widgets').select('*').range(0, 9);
    expect(calls.some(c => c.sql.includes('COUNT(*)'))).toBe(false);
  });
})
