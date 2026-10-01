import {
  defineLogicFunction,
  type DatabaseEventPayload,
  type ObjectRecordUpdateEvent,
} from 'twenty-sdk/define';
import { DELIVER_PAYMENT_RECEIPT } from 'src/constants/universal-identifiers';
import { CoreDbClient } from 'src/lib/records';
import { deliverPaymentReceipt } from 'src/lib/receipt-delivery';

type PaymentRecord = {
  id: string;
  status?: string | null;
};

/**
 * When a payment is confirmed (provider callback, staff confirmation or the
 * pay flow), send the payer their receipt on WhatsApp as a PDF attachment.
 * KV-backed idempotency keeps a retried trigger from sending twice.
 */
export const handler = async (
  payload: DatabaseEventPayload<ObjectRecordUpdateEvent<PaymentRecord>>,
) => {
  const after = payload.properties.after;
  const before = payload.properties.before;
  const paymentId = String(after?.id ?? '');
  if (!paymentId) return { processed: false, reason: 'no payment id' };
  // Only the transition into CONFIRMED delivers; later edits must not re-send.
  if (String(after?.status ?? '') !== 'CONFIRMED') {
    return { processed: false, reason: 'not confirmed' };
  }
  if (String(before?.status ?? '') === 'CONFIRMED') {
    return { processed: false, reason: 'already confirmed before this update' };
  }
  const db = new CoreDbClient();
  const result = await deliverPaymentReceipt(db, paymentId);
  if (result.status === 'failed') console.error('receipt delivery', result);
  return { processed: true, ...result };
};

export default defineLogicFunction({
  universalIdentifier: DELIVER_PAYMENT_RECEIPT,
  name: 'deliver-payment-receipt',
  description:
    'Sends the customer a payment receipt PDF on WhatsApp once their payment confirms.',
  timeoutSeconds: 60,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'insurancePayment.updated',
  },
});
