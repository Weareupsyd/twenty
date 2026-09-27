import type { Pool, QueryResult, QueryResultRow } from 'pg';
import { supabase } from '@/config/database.js';

export function amlPool(): Pool {
  const client = supabase as unknown as { pool?: Pool };
  if (!client.pool) {
    throw new Error('AML TypeScript port requires DATABASE_URL (Community Postgres)');
  }
  return client.pool;
}

export async function amlQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return amlPool().query<T>(sql, params);
}
