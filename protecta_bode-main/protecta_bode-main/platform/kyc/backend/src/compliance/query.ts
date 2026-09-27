import type { QueryResult, QueryResultRow } from 'pg';
import { supabase } from '@/config/database.js';

export function compliancePool() {
  const client = supabase as unknown as { pool?: { query: Function } };
  if (!client.pool) {
    throw Object.assign(new Error('Phase 3 combined API requires DATABASE_URL (Community Postgres)'), { status: 503 });
  }
  return client.pool as { query: <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => Promise<QueryResult<T>> };
}

export async function cquery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return compliancePool().query<T>(sql, params);
}

/** Run a query; return empty rows if the relation is missing (fresh DB / optional KYB tables). */
export async function optionalQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const { rows } = await cquery<T>(sql, params);
    return rows;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not exist|undefined table|relation .* does not exist/i.test(msg)) return [];
    throw err;
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  if (typeof value === 'object') return value as Record<string, unknown>;
  return {};
}

export function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value) && value.length) return firstString(value[0]);
  }
  return '';
}
