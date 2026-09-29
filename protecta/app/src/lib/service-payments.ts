import { createWithUniqueRef } from 'src/lib/generate-ref';
import { normalizeUgPhone } from 'src/lib/phones';
import { type DbClient, type RecordData } from 'src/lib/records';
import { makePaymentRef } from 'src/lib/refs';

export type PaymentProvider = 'mtn_momo' | 'airtel_money' | 'bank';

export const normalizeProvider = (raw: string | null | undefined): PaymentProvider | null => {
  const value = (raw ?? '').trim().toLowerCase();
  if (['mtn', 'mtn_momo', 'momo', 'mtn-momo'].includes(value)) {
    return 'mtn_momo';
  }
  if (['airtel', 'airtel_money', 'airtel-money'].includes(value)) {
    return 'airtel_money';
  }
  if (['bank', 'stanbic', 'transfer'].includes(value)) {
    return 'bank';
  }
  return null;
};

export const createPayment = async (
  db: DbClient,
  input: {
    quoteId: string;
    quoteRef: string;
    amountUgx: number;
    provider: PaymentProvider;
    payerPhone: string;
    providerRef?: string;
    rng?: () => number;
  },
): Promise<RecordData> => {
  const phone = normalizeUgPhone(input.payerPhone);
  if (!phone) {
    throw new Error('A valid payer phone number is required.');
  }
  if (!Number.isFinite(input.amountUgx) || input.amountUgx <= 0) {
    throw new Error('Payment amount must be positive.');
  }
  // Unique PAY-xxxxxx reference: redraw on the rare collision.
  return createWithUniqueRef(() => {
    const paymentRef = makePaymentRef(input.rng);
    return db.create('insurancePayment', {
      protectaRef: paymentRef,
      paymentRef,
      quoteRef: input.quoteRef,
      provider: input.provider,
      providerRef: input.providerRef ?? '',
      payerPhone: phone,
      amountUgx: input.amountUgx,
      status: 'PENDING',
      quoteId: input.quoteId,
    });
  });
};

export const findPaymentByRef = (db: DbClient, paymentRef: string): Promise<RecordData | null> =>
  db.findFirst('insurancePayments', { paymentRef: { eq: paymentRef } }, [
    'paymentRef',
    'protectaRef',
    'quoteRef',
    'provider',
    'providerRef',
    'payerPhone',
    'amountUgx',
    'status',
  ]);

export const confirmPayment = async (
  db: DbClient,
  payment: RecordData,
  providerRef?: string,
): Promise<RecordData> =>
  db.update('insurancePayment', String(payment.id), {
    status: 'CONFIRMED',
    ...(providerRef ? { providerRef } : {}),
  });

export const failPayment = async (
  db: DbClient,
  payment: RecordData,
  providerRef?: string,
): Promise<RecordData> =>
  db.update('insurancePayment', String(payment.id), {
    status: 'FAILED',
    ...(providerRef ? { providerRef } : {}),
  });
