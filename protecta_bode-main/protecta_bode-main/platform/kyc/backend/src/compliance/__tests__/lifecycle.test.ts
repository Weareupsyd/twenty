import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffPrincipal } from '../staffAuth.js';

/**
 * lifecycle.ts talks to Postgres through ./query.js and logs through
 * @/utils/logger.js. Both are mocked so these tests exercise the real
 * decision logic - guard clauses, attribution, reason bucketing - without a
 * database. The SQL itself is verified separately against a Postgres engine.
 */
const cquery = vi.fn();
const optionalQuery = vi.fn();

vi.mock('../query.js', () => ({
  cquery: (...args: unknown[]) => cquery(...args),
  optionalQuery: (...args: unknown[]) => optionalQuery(...args),
}));

vi.mock('@/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const {
  extendVerificationLink,
  findSweepCandidates,
  restoreVerification,
  sweepStaleVerifications,
  voidVerification,
} = await import('../lifecycle.js');

const ID = '11111111-1111-4111-8111-111111111111';

const staff = (over: Partial<StaffPrincipal> = {}): StaffPrincipal => ({
  id: '22222222-2222-4222-8222-222222222222',
  email: 'ops@kabila.test',
  full_name: 'Ops',
  role: 'admin',
  aml_role: 'superuser',
  readonly: false,
  scopes: ['kyc', 'aml'],
  ...over,
} as StaffPrincipal);

beforeEach(() => {
  cquery.mockReset();
  optionalQuery.mockReset();
});

describe('voidVerification', () => {
  it('rejects a non-uuid before touching the database', async () => {
    await expect(voidVerification({ id: 'SUB-90411', staff: staff() }))
      .rejects.toMatchObject({ status: 400 });
    expect(cquery).not.toHaveBeenCalled();
  });

  it('refuses read-only auditor accounts', async () => {
    await expect(voidVerification({ id: ID, staff: staff({ readonly: true }) }))
      .rejects.toMatchObject({ status: 403 });
    expect(cquery).not.toHaveBeenCalled();
  });

  it('404s when the verification does not exist', async () => {
    optionalQuery.mockResolvedValueOnce([]);
    await expect(voidVerification({ id: ID, staff: staff() }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('soft-voids with reason + actor and never issues a DELETE', async () => {
    optionalQuery.mockResolvedValueOnce([{ id: ID, status: 'pending', voided_at: null }]);
    cquery.mockResolvedValueOnce({
      rows: [{ id: ID, status: 'pending', voided_at: new Date(), voided_by: 'x', void_reason: 'expired' }],
    });

    const out = await voidVerification({ id: ID, reason: 'expired', staff: staff() });

    const [sql, params] = cquery.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE public\.verification_requests/i);
    expect(String(sql)).not.toMatch(/DELETE/i); // audit trail is preserved
    expect(String(sql)).toMatch(/voided_at\s*=\s*COALESCE/i);
    expect(params).toEqual([ID, '22222222-2222-4222-8222-222222222222', 'expired']);
    expect(out.void_reason).toBe('expired');
  });

  it('defaults the reason and falls back to email attribution', async () => {
    optionalQuery.mockResolvedValueOnce([{ id: ID, status: 'pending', voided_at: null }]);
    cquery.mockResolvedValueOnce({ rows: [{ id: ID, status: 'pending', voided_at: new Date(), voided_by: null, void_reason: null }] });

    await voidVerification({ id: ID, staff: staff({ id: 'not-a-uuid' }) });

    expect(cquery.mock.calls[0][1]).toEqual([ID, 'ops@kabila.test', 'operator']);
  });
});

describe('restoreVerification', () => {
  it('clears every void field so the row re-enters the counters', async () => {
    cquery.mockResolvedValueOnce({ rows: [{ id: ID, status: 'pending', voided_at: null, voided_by: null, void_reason: null }] });
    const out = await restoreVerification({ id: ID, staff: staff() });
    expect(String(cquery.mock.calls[0][0])).toMatch(/voided_at\s*=\s*NULL/i);
    expect(out.voided_at).toBeNull();
  });

  it('404s on an unknown id', async () => {
    cquery.mockResolvedValueOnce({ rows: [] });
    await expect(restoreVerification({ id: ID, staff: staff() })).rejects.toMatchObject({ status: 404 });
  });
});

describe('extendVerificationLink', () => {
  const row = (over = {}) => [{ id: ID, status: 'pending', voided_at: null, session_token_hash: 'abc', ...over }];

  it('refuses to extend a deleted verification', async () => {
    optionalQuery.mockResolvedValueOnce(row({ voided_at: new Date() }));
    await expect(extendVerificationLink({ id: ID, staff: staff() }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('refuses when there is no hosted link', async () => {
    optionalQuery.mockResolvedValueOnce(row({ session_token_hash: null }));
    await expect(extendVerificationLink({ id: ID, staff: staff() }))
      .rejects.toMatchObject({ status: 409 });
  });

  it.each(['verified', 'approved', 'failed', 'rejected'])(
    'refuses to reopen a settled (%s) verification', async (status) => {
      optionalQuery.mockResolvedValueOnce(row({ status }));
      await expect(extendVerificationLink({ id: ID, staff: staff() }))
        .rejects.toMatchObject({ status: 409 });
    });

  it('moves expiry into the future, leaves the token alone, bumps the count', async () => {
    optionalQuery.mockResolvedValueOnce(row());
    cquery.mockResolvedValueOnce({
      rows: [{ id: ID, session_token_expires_at: new Date(Date.now() + 3600e3), extended_at: new Date(), extended_by: 'x', extension_count: 1 }],
    });

    const out = await extendVerificationLink({ id: ID, staff: staff() });

    const [sql, params] = cquery.mock.calls[0];
    // The applicant's original URL must keep working: only expiry moves.
    expect(String(sql)).not.toMatch(/session_token_hash/i);
    expect(String(sql)).toMatch(/extension_count\s*=\s*COALESCE\(extension_count, 0\) \+ 1/i);
    expect(new Date(params[1] as string).getTime()).toBeGreaterThan(Date.now());
    expect(out.extension_count).toBe(1);
  });

  it('honours a custom window', async () => {
    optionalQuery.mockResolvedValueOnce(row());
    cquery.mockResolvedValueOnce({ rows: [{ id: ID, session_token_expires_at: new Date(), extended_at: new Date(), extended_by: 'x', extension_count: 2 }] });

    await extendVerificationLink({ id: ID, windowMs: 48 * 3600e3, staff: staff() });

    const target = new Date(cquery.mock.calls[0][1][1] as string).getTime();
    expect(target).toBeGreaterThan(Date.now() + 47 * 3600e3);
  });
});

describe('findSweepCandidates', () => {
  it('never sweeps settled or in-review work', async () => {
    optionalQuery.mockResolvedValueOnce([]);
    await findSweepCandidates();
    const sql = String(optionalQuery.mock.calls[0][0]);
    expect(sql).toMatch(/voided_at IS NULL/i);
    for (const status of ['verified', 'approved', 'failed', 'declined', 'rejected', 'manual_review', 'in_review']) {
      expect(sql).toContain(`'${status}'`);
    }
  });

  it('passes the staleness horizon through as a parameter', async () => {
    optionalQuery.mockResolvedValueOnce([]);
    await findSweepCandidates({ staleHours: 72 });
    expect(optionalQuery.mock.calls[0][1]).toEqual(['72']);
  });

  it('defaults to 24 hours', async () => {
    optionalQuery.mockResolvedValueOnce([]);
    await findSweepCandidates();
    expect(optionalQuery.mock.calls[0][1]).toEqual(['24']);
  });
});

describe('sweepStaleVerifications', () => {
  const candidates = [
    { id: ID, status: 'pending', created_at: new Date(), session_token_expires_at: new Date(), reason: 'expired' },
    { id: '33333333-3333-4333-8333-333333333333', status: 'pending', created_at: new Date(), session_token_expires_at: null, reason: 'stale' },
  ];

  it('dry run reports the blast radius without writing', async () => {
    optionalQuery.mockResolvedValueOnce(candidates);
    const res = await sweepStaleVerifications({ dryRun: true });
    expect(res).toMatchObject({ scanned: 2, voided: 0, expired: 1, stale: 1, dry_run: true });
    expect(cquery).not.toHaveBeenCalled();
  });

  it('voids each reason bucket separately and attributes the job', async () => {
    optionalQuery.mockResolvedValueOnce(candidates);
    cquery.mockResolvedValue({ rows: [] });

    const res = await sweepStaleVerifications({});

    expect(res.voided).toBe(2);
    expect(cquery).toHaveBeenCalledTimes(2);
    const reasons = cquery.mock.calls.map((c) => (c[1] as unknown[])[2]);
    expect(reasons).toEqual(['expired', 'stale']);
    // Unattended runs are attributable in the audit trail.
    expect((cquery.mock.calls[0][1] as unknown[])[1]).toBe('system:eod-sweep');
    // Re-voiding an already-voided row is impossible.
    expect(String(cquery.mock.calls[0][0])).toMatch(/AND voided_at IS NULL/i);
  });

  it('does nothing when there is nothing to sweep', async () => {
    optionalQuery.mockResolvedValueOnce([]);
    const res = await sweepStaleVerifications({});
    expect(res.voided).toBe(0);
    expect(cquery).not.toHaveBeenCalled();
  });

  it('records a human actor when run on demand', async () => {
    optionalQuery.mockResolvedValueOnce([candidates[0]]);
    cquery.mockResolvedValue({ rows: [] });
    await sweepStaleVerifications({ actor: 'ops@kabila.test' });
    expect((cquery.mock.calls[0][1] as unknown[])[1]).toBe('ops@kabila.test');
  });
});
