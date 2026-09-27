import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchDashboardProfile, deriveIsOperator } from './operatorSession';

const OP = { email: 'op@example.com', api_key_id: 'k1', key_prefix: 'isk_aaaa', service_label: 'gw', service_product: 'p', service_environment: 'production' };

afterEach(() => { vi.restoreAllMocks(); });

function response(status: number, body: any) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function mockFetchSequence(...items: Array<{ status: number; body: any }>) {
  const mock = vi.fn();
  for (const item of items) mock.mockResolvedValueOnce(response(item.status, item.body));
  vi.stubGlobal('fetch', mock as any);
  return mock;
}

describe('deriveIsOperator', () => {
  it('true when operator block present', () => {
    expect(deriveIsOperator({ scope: 'service-operator', operator: OP })).toBe(true);
  });
  it('false for a developer profile', () => {
    expect(deriveIsOperator({ scope: 'developer', data: { id: 'd1' } })).toBe(false);
  });
});

describe('fetchDashboardProfile', () => {
  it('returns authed=false without requesting the protected profile when logged out', async () => {
    const fetchMock = mockFetchSequence(
      { status: 200, body: { csrfToken: 'csrf' } },
      { status: 200, body: { authenticated: false } },
    );
    const r = await fetchDashboardProfile();
    expect(r).toEqual({ authed: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/developer/profile'))).toBe(false);
  });
  it('returns operator context on an operator profile', async () => {
    mockFetchSequence(
      { status: 200, body: { csrfToken: 'csrf' } },
      { status: 200, body: { authenticated: true, principal: 'service-operator' } },
      { status: 200, body: { success: true, scope: 'service-operator', operator: OP } },
    );
    const r = await fetchDashboardProfile();
    expect(r.authed).toBe(true);
    if (r.authed) { expect(r.isOperator).toBe(true); expect(r.operator).toEqual(OP); }
  });
  it('returns non-operator context on a developer profile', async () => {
    mockFetchSequence(
      { status: 200, body: { csrfToken: 'csrf' } },
      { status: 200, body: { authenticated: true, principal: 'developer' } },
      { status: 200, body: { success: true, data: { id: 'd1', email: 'dev@x.com' } } },
    );
    const r = await fetchDashboardProfile();
    expect(r.authed).toBe(true);
    if (r.authed) { expect(r.isOperator).toBe(false); expect(r.operator).toBeNull(); }
  });
});
