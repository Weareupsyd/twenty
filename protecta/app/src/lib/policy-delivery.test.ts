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
  it('sends the template document on WhatsApp and email', async () => {
    const db = makeDb([{ reference: 'DOC-1', status: 'GENERATED', content: '# MOTOR PROTECTA BODE POLICY\nHello\n| A | B |\n| 1 | 2 |' }]);
    const sendDocument = vi.fn(async () => ({ messageId: 'm' }));
    const sendEmailFn = vi.fn(async () => {});
    const r = await deliverPolicyDocument(db as any, 'PB-1', { sendDocument, email: { apiKey: 'k', from: 'f' }, sendEmailFn, sleep: async () => {} });
    expect(r).toMatchObject({ source: 'template', whatsapp: 'sent', email: 'sent' });
    expect((sendDocument.mock.calls as any)[0][0]).toBe('+256701440613');
    expect((sendEmailFn.mock.calls as any)[0][1].attachments[0].filename).toContain('PB-1');
  });
  it('falls back to the certificate when the generator is not installed', async () => {
    const db = makeDb(new Error('no object'));
    const r = await deliverPolicyDocument(db as any, 'PB-1', { sendDocument: vi.fn(async () => ({ messageId: null })), email: null, sleep: async () => {} });
    expect(r).toMatchObject({ source: 'certificate', whatsapp: 'sent', email: 'skipped' });
  });
  it('requests a document when none appears', async () => {
    const db = makeDb([]);
    await deliverPolicyDocument(db as any, 'PB-1', { sendDocument: null, email: null, sleep: async () => {}, attempts: 4 });
    expect(db.create).toHaveBeenCalledWith('generatedDocument', expect.objectContaining({ policyNo: 'PB-1' }));
  });
});
