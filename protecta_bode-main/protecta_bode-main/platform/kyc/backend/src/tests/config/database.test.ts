import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), supabaseQuery: vi.fn(), getUser: vi.fn() }));
vi.mock('@/adapters/pg/PgClient.js', () => ({
  PgClient: class { pool = { query: db.query }; },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ limit: () => db.supabaseQuery() }) }),
    auth: { getUser: db.getUser },
  }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost/test');
  vi.stubEnv('SUPABASE_URL', '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('startup database check', () => {
  it('checks PostgreSQL with a real query', async () => {
    db.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const { connectDB } = await import('@/config/database.js');
    expect(await connectDB()).toBe(true);
    expect(db.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns false when PostgreSQL rejects the password', async () => {
    db.query.mockRejectedValue(Object.assign(new Error('password authentication failed'), { code: '28P01' }));
    const { connectDB } = await import('@/config/database.js');
    expect(await connectDB()).toBe(false);
  });

  it.each([null, { code: 'PGRST301', message: 'database error' }])('checks returned Supabase errors: %s', async error => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-role-key');
    db.supabaseQuery.mockResolvedValue({ data: [], error });
    const { connectDB } = await import('@/config/database.js');
    expect(await connectDB()).toBe(!error);
    expect(db.supabaseQuery).toHaveBeenCalled();
    expect(db.getUser).not.toHaveBeenCalled();
  });
});
