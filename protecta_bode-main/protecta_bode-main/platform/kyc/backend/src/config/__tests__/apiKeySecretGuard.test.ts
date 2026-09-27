/**
 * Regression: `_system_config` upsert must use its real primary key.
 *
 * The community Postgres adapter (`PgQueryBuilder.executeUpsert`) defaults to
 * `ON CONFLICT ("id")` when the caller does not pass `{ onConflict }`. The
 * `_system_config` table created by `verifyApiKeySecretStability` declares
 * `key` as its PRIMARY KEY, so that defaulting in the community mode produced:
 *
 *   ERROR: column "id" does not exist
 *   INSERT INTO _system_config ... ON CONFLICT ("id") ...
 *
 * On Supabase the real client uses the table's primary key automatically;
 * this test locks in the explicit target so the community/docker mode behaves
 * the same way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
const upsert = vi.hoisted(() => vi.fn());
const select = vi.hoisted(() => vi.fn());

vi.mock('@/config/database.js', () => ({
  supabase: {
    rpc,
    from: vi.fn(() => ({
      select,
      upsert,
    })),
  },
}));

vi.mock('@/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { verifyApiKeySecretStability } from '../apiKeySecretGuard.js';

describe('API_KEY_SECRET stability guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: null, error: null });
    // First boot: the select returns no existing row so the guard stores a fingerprint.
    select.mockReturnValue({
      eq: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      })),
    });
  });

  it('upserts the fingerprint against the key column in community/Docker Postgres', async () => {
    await verifyApiKeySecretStability('test-secret');

    expect(rpc).toHaveBeenCalledWith('exec_sql', {
      query: expect.stringContaining('CREATE TABLE IF NOT EXISTS _system_config'),
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    const [payload, options] = upsert.mock.calls[0] as [Record<string, unknown>, { onConflict?: string } | undefined];
    expect(payload).toMatchObject({ key: 'api_key_secret_fingerprint' });
    expect(options).toEqual({ onConflict: 'key' });
  });
});
