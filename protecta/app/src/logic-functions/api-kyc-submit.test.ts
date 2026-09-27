import { describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({
  submit: vi.fn(async () => ({
    kycCase: { id: 'kyc-1', status: 'PENDING' },
    person: { id: 'person-1' },
  })),
}));
vi.mock('src/lib/service-kyc', () => ({ submitKyc: mocked.submit }));
vi.mock('src/lib/records', () => ({ CoreDbClient: class {} }));
import { handler } from 'src/logic-functions/api-kyc-submit.logic-function';
import { routeEvent } from 'src/test-utils/route-event';
describe('KYC intake', () => {
  it('maps the existing form to the supported schema and returns the actual case', async () => {
    const response = await handler(
      routeEvent({
        body: {
          phone: '0772000000',
          policyholderName: 'Test Person',
          nationalIdNumber: 'TEST-ID-123',
          dateOfBirth: '1990-01-01',
          quoteRef: '12345',
        },
      }),
    );
    const input = (
      mocked.submit.mock.calls[0] as unknown as [
        unknown,
        Record<string, unknown>,
      ]
    )[1];
    expect(input).toMatchObject({
      name: 'Test Person',
      idType: 'NIN',
      idNumber: 'TEST-ID-123',
    });
    expect(JSON.parse(String(input.reviewNotes))).toMatchObject({
      dateOfBirth: '1990-01-01',
      quoteRef: '12345',
    });
    expect(response.status).toBe(201);
    expect(JSON.parse(String(response.body))).toEqual({
      ok: true,
      kyc: { id: 'kyc-1', status: 'PENDING' },
    });
  });
});
