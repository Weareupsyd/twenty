import { describe, expect, it, vi } from 'vitest';
import { deliverPolicyDocument } from 'src/lib/policy-delivery';

const makeDb = (docs: any[] | Error) => ({
  findFirst: vi.fn(async (obj: string) => {
    if (obj === 'insurancePolicies') return { id: 'p1', policyNo: 'PB-1', plate: 'UBA 1X', quoteRef: 'Q1', periodStart: '2026-09-29', periodEnd: '2027-09-28', premiumUgx: 450000 };
    if (obj === 'insuranceQuotes') return { id: 'q1', reference: 'Q1', policyholderPhone: '+256701440613' };
    if (obj === 'people') return { emails: { primaryEmail: 'a@b.co' }, name: { firstName: 'Jane', lastName: 'D' } };
    return null;
  }),
  findMany: vi.fn(async () => { if (docs instanceof Error) throw docs; return docs; }),
  create: vi.fn(async () => ({})),
  update: vi.fn(),
});

describe('deliverPolicyDocument', () => {
  it('sends a phone-verified download link instead of an unencrypted PDF attachment', async () => {
    const db = makeDb([{ reference: 'DOC-1', status: 'GENERATED', content: '# MOTOR PROTECTA BODE POLICY\nHello\n| A | B |\n| 1 | 2 |' }]);
    const sendText = vi.fn(async () => ({ messageId: 'm' }));
    const sendEmailFn = vi.fn(async () => {});
    const result = await deliverPolicyDocument(db as any, 'PB-1', {
      sendText,
      email: { apiKey: 'k', from: 'f' },
      sendEmailFn,
      sleep: async () => {},
    });

    expect(result).toMatchObject({ documentStatus: 'ready', whatsapp: 'sent', email: 'sent' });
    expect((sendText.mock.calls as any)[0][0]).toBe('+256701440613');
    expect((sendText.mock.calls as any)[0][1]).toContain(
      '/s/protecta/policies/doc?ref=PB-1',
    );
    expect((sendEmailFn.mock.calls as any)[0][1].html).toContain(
      '/s/protecta/policies/doc?ref=PB-1',
    );
    expect((sendEmailFn.mock.calls as any)[0][1].attachments).toBeUndefined();
  });

  it('does not send an insecure certificate attachment when the generator is unavailable', async () => {
    const db = makeDb(new Error('no object'));
    const sendText = vi.fn(async () => ({ messageId: null }));
    const result = await deliverPolicyDocument(db as any, 'PB-1', {
      sendText,
      email: null,
      sleep: async () => {},
    });

    expect(result).toMatchObject({ documentStatus: 'unavailable', whatsapp: 'sent', email: 'skipped' });
  });

  it('requests a document when none appears', async () => {
    const db = makeDb([]);
    await deliverPolicyDocument(db as any, 'PB-1', {
      sendText: null,
      email: null,
      sleep: async () => {},
      attempts: 4,
    });
    expect(db.create).toHaveBeenCalledWith(
      'generatedDocument',
      expect.objectContaining({ policyNo: 'PB-1' }),
    );
  });
});
