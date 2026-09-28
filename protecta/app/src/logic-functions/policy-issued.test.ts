import { afterEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({
  findFirst: vi.fn(
    async (..._args: unknown[]): Promise<Record<string, unknown> | null> => ({
      id: 'pol-1',
      policyNo: 'PB-2026-004213',
      premiumUgx: 150000,
      plate: 'UAX 123C',
      periodStart: '2026-09-28',
      periodEnd: '2027-09-28',
    }),
  ),
  findQuoteByRef: vi.fn(
    async (..._args: unknown[]): Promise<Record<string, unknown> | null> => ({
      reference: '123456789012345',
      policyholderPhone: '0772000000',
      plate: 'UAX 123C',
    }),
  ),
}));
vi.mock('src/lib/records', () => ({
  CoreDbClient: class {
    findFirst(...args: unknown[]) {
      return mocked.findFirst(...args);
    }
  },
}));
vi.mock('src/lib/service-quotes', () => ({
  findQuoteByRef: mocked.findQuoteByRef,
}));
vi.mock('src/lib/email', () => ({
  emailConfigFromEnv: () => null,
  sendEmail: vi.fn(),
}));
vi.mock('src/lib/service-policies', () => ({
  policyCertUrl: () => 'https://example.test/s/protecta/policies/doc?ref=PB-2026-004213',
}));
vi.mock('twenty-sdk/logic-function', () => ({
  kv: { get: vi.fn(), set: vi.fn() },
  RetryableLogicFunctionError: class extends Error {},
}));
vi.mock('twenty-client-sdk/core', () => ({
  CoreApiClient: class {
    query = vi.fn();
  },
}));
import { handler } from 'src/logic-functions/policy-issued.logic-function';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('policy-issued', () => {
  it('triggers the SMS even when the email provider is unconfigured', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, reference: 'SMS-1', status: 'SENT' }), {
          status: 201,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await handler({ quoteRef: '123456789012345' });
    expect(result.sms).toBe('sent');
    expect(result.skipped).toBe('Email provider is not configured.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/s/sms/send');
    const body = JSON.parse(String(init.body));
    expect(body.phone).toBe('0772000000');
    expect(body.eventKey).toBe('POLICY_ISSUED');
    expect(body.variables).toMatchObject({
      policyNo: 'PB-2026-004213',
      quoteRef: '123456789012345',
      plate: 'UAX 123C',
    });
    expect(body.variables.premiumUgx).toBe('150,000');
  });

  it('never fails the job when the SMS app is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const result = await handler({ quoteRef: '123456789012345' });
    expect(result.sms).toBe('not sent (unreachable)');
  });

  it('still throws when the policy is missing', async () => {
    mocked.findFirst.mockResolvedValueOnce(null);
    await expect(handler({ quoteRef: 'nope' })).rejects.toThrow(
      'Issued policy or quote not found.',
    );
  });
});
