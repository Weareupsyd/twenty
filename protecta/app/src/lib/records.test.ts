import { beforeEach, describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  constructor: vi.fn(),
}));
vi.mock('twenty-client-sdk/core', () => ({
  CoreApiClient: class {
    constructor(options: unknown) {
      calls.constructor(options);
    }
    query = calls.query;
    mutation = calls.mutation;
  },
}));
import { CoreDbClient } from 'src/lib/records';
beforeEach(() => vi.clearAllMocks());
describe('CoreDbClient', () => {
  it('preserves submitted fields when Twenty returns only the generated ID', async () => {
    calls.mutation.mockResolvedValue({
      createInsurancePayment: { id: 'payment-id' },
    });
    const row = await new CoreDbClient().create('insurancePayment', {
      paymentRef: 'PAY-123',
      amountUgx: 1000,
    });
    expect(row).toEqual({
      id: 'payment-id',
      paymentRef: 'PAY-123',
      amountUgx: 1000,
    });
  });
  it('returns updated values and uses the caller role when requested', async () => {
    calls.mutation.mockResolvedValue({ updateKycCase: { id: 'kyc-id' } });
    const row = await new CoreDbClient({ runAs: 'user' }).update(
      'kycCase',
      'kyc-id',
      { status: 'APPROVED' },
    );
    expect(calls.constructor).toHaveBeenCalledWith({ runAs: 'user' });
    expect(row.status).toBe('APPROVED');
  });
  it('selects subfields for composite person names', async () => {
    calls.query.mockResolvedValue({ people: { edges: [] } });
    await new CoreDbClient().findFirst('people', {}, ['name']);
    expect(calls.query.mock.calls[0][0].people.edges.node.name).toEqual({
      firstName: true,
      lastName: true,
    });
  });
  it('does not fabricate a successful mutation if the API returns no record', async () => {
    calls.mutation.mockResolvedValue({ createInsurancePayment: null });
    await expect(
      new CoreDbClient().create('insurancePayment', { paymentRef: 'PAY-123' }),
    ).rejects.toThrow('returned no record');
  });
});
