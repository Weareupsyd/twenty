import { describe, expect, it, vi } from 'vitest';
import { deliverPaymentReceipt } from 'src/lib/receipt-delivery';
import { type StateStore } from 'src/lib/service-otp';

type DbOverrides = {
  payment?: Record<string, unknown>;
  quote?: Record<string, unknown>;
};

const makeDb = (overrides: DbOverrides = {}) => ({
  findFirst: vi.fn(async (object: string) => {
    if (object === 'insurancePayments') {
      return {
        id: 'pay-1',
        protectaRef: 'R-1001',
        paymentRef: 'MTN-88412',
        quoteRef: '482913',
        provider: 'MTN',
        providerRef: 'MTN-88412',
        payerPhone: '+256772000000',
        amountUgx: 150000,
        status: 'CONFIRMED',
        ...overrides.payment,
      };
    }
    if (object === 'insuranceQuotes') {
      return {
        reference: '482913',
        premium: 150000,
        policyholderPhone: '+256772000000',
        plate: 'UAX 123C',
        vehicleMake: 'Toyota',
        vehicleModel: 'Premio',
        ...overrides.quote,
      };
    }
    if (object === 'insurancePolicies') {
      return { policyNo: 'PB-2026-0007', periodStart: 'a', periodEnd: 'b' };
    }
    if (object === 'people') {
      return { name: { firstName: 'Jane', lastName: 'Doe' } };
    }
    return null;
  }),
});

/** KV-shaped store plus the mocks underneath it, for assertions. */
const makeStore = () => {
  const map = new Map<string, unknown>();
  const get = vi.fn((key: string) => map.get(key) ?? null);
  const set = vi.fn((key: string, value: unknown) => {
    map.set(key, value);
  });
  const removed = vi.fn((key: string) => map.delete(key));
  const store: StateStore = {
    get: async <TValue = unknown>(key: string) =>
      (get(key) as TValue | null) ?? null,
    set: async <TValue>(key: string, value: TValue) => {
      set(key, value);
    },
    delete: async (key: string) => removed(key),
  };
  return { store, get, set, removed };
};

describe('deliverPaymentReceipt', () => {
  it('sends the receipt PDF to the payer once the payment confirms', async () => {
    const sendDocument = vi.fn(async () => ({ messageId: 'm1' }));
    const kv = makeStore();

    const result = await deliverPaymentReceipt(makeDb() as never, 'pay-1', {
      store: kv.store,
      docSender: sendDocument,
    });

    expect(result).toEqual({ paymentId: 'pay-1', status: 'sent' });
    expect(sendDocument).toHaveBeenCalledOnce();
    const [phone, doc] = sendDocument.mock.calls[0] as unknown as [
      string,
      { fileName: string; caption: string; mimeType: string },
    ];
    expect(phone).toBe('+256772000000');
    expect(doc.fileName).toBe('Protecta-Receipt-RCP-R-1001.pdf');
    expect(doc.mimeType).toBe('application/pdf');
    expect(doc.caption).toContain('RCP-R-1001');
    expect(kv.set).toHaveBeenCalledWith('receipt-sent:pay-1', true);
  });

  it('never sends twice for the same payment', async () => {
    const sendDocument = vi.fn(async () => ({ messageId: 'm1' }));
    const kv = makeStore();
    const db = makeDb() as never;

    await deliverPaymentReceipt(db, 'pay-1', { store: kv.store, docSender: sendDocument });
    const second = await deliverPaymentReceipt(db, 'pay-1', {
      store: kv.store,
      docSender: sendDocument,
    });

    expect(second).toEqual({ paymentId: 'pay-1', status: 'skipped', reason: 'already sent' });
    expect(sendDocument).toHaveBeenCalledOnce();
  });

  it('skips payments that have not confirmed', async () => {
    const sendDocument = vi.fn(async () => ({ messageId: 'm1' }));
    const result = await deliverPaymentReceipt(
      makeDb({ payment: { status: 'PENDING' } }) as never,
      'pay-1',
      { store: makeStore().store, docSender: sendDocument },
    );
    expect(result.status).toBe('skipped');
    expect(sendDocument).not.toHaveBeenCalled();
  });

  it('skips when WhatsApp is not connected', async () => {
    const result = await deliverPaymentReceipt(makeDb() as never, 'pay-1', {
      store: makeStore().store,
      docSender: null,
    });
    expect(result).toEqual({
      paymentId: 'pay-1',
      status: 'skipped',
      reason: 'WhatsApp is not connected',
    });
  });

  it('reports a send failure without marking the receipt sent', async () => {
    const kv = makeStore();
    const sendDocument = vi.fn(async () => {
      throw new Error('provider refused');
    });
    const result = await deliverPaymentReceipt(makeDb() as never, 'pay-1', {
      store: kv.store,
      docSender: sendDocument,
    });
    expect(result).toEqual({
      paymentId: 'pay-1',
      status: 'failed',
      reason: 'provider refused',
    });
    expect(kv.set).not.toHaveBeenCalled();
  });
});
