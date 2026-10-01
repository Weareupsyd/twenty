import { kv } from 'twenty-sdk/logic-function';
import { paymentReceiptDocument } from 'src/lib/conversation-docs';
import { type DbClient } from 'src/lib/records';
import {
  findPersonByPhone,
  findQuoteByRef,
  personDisplayName,
} from 'src/lib/service-quotes';
import { type StateStore } from 'src/lib/service-otp';
import { whatsAppDocSender } from 'src/lib/whatsapp-transport';

export type ReceiptDeliveryResult = {
  paymentId: string;
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
};

const PAYMENT_FIELDS = [
  'id',
  'protectaRef',
  'paymentRef',
  'quoteRef',
  'provider',
  'providerRef',
  'payerPhone',
  'amountUgx',
  'status',
];

/**
 * Sends the payment receipt to the payer on WhatsApp once an insurancePayment
 * reaches CONFIRMED. Best-effort: a missing WhatsApp connection or renderer
 * skips or falls back rather than failing the confirmation. Idempotent through
 * KV so a retried trigger never sends the receipt twice.
 */
export const deliverPaymentReceipt = async (
  db: DbClient,
  paymentId: string,
  deps: { store?: StateStore; docSender?: Awaited<ReturnType<typeof whatsAppDocSender>> | null } = {},
): Promise<ReceiptDeliveryResult> => {
  const store = deps.store ?? kv;
  const sentKey = `receipt-sent:${paymentId}`;

  const payment = await db.findFirst('insurancePayments', { id: { eq: paymentId } }, PAYMENT_FIELDS);
  if (!payment) {
    return { paymentId, status: 'skipped', reason: 'payment not found' };
  }
  if (String(payment.status ?? '') !== 'CONFIRMED') {
    return { paymentId, status: 'skipped', reason: 'payment is not confirmed' };
  }
  if (await store.get(sentKey)) {
    return { paymentId, status: 'skipped', reason: 'already sent' };
  }

  const quote = await findQuoteByRef(db, String(payment.quoteRef ?? ''));
  if (!quote) {
    return { paymentId, status: 'skipped', reason: 'quote not found' };
  }

  const phone = String(payment.payerPhone ?? quote.policyholderPhone ?? '').trim();
  if (!phone) {
    return { paymentId, status: 'skipped', reason: 'payer has no phone' };
  }

  const policy = await db
    .findFirst(
      'insurancePolicies',
      { quoteRef: { eq: String(quote.reference ?? '') } },
      ['policyNo', 'periodStart', 'periodEnd'],
    )
    .catch(() => null);

  const person = await findPersonByPhone(db, phone).catch(() => null);
  const name = person ? personDisplayName(person) : '';

  const sendDocument =
    deps.docSender !== undefined ? deps.docSender : await whatsAppDocSender();
  if (!sendDocument) {
    return { paymentId, status: 'skipped', reason: 'WhatsApp is not connected' };
  }

  try {
    const doc = await paymentReceiptDocument({
      payment,
      quote,
      policy,
      ...(name ? { name } : {}),
    });
    await sendDocument(phone, doc);
  } catch (error) {
    return {
      paymentId,
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  await store.set(sentKey, true);
  return { paymentId, status: 'sent' };
};
