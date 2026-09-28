import {
  defineLogicFunction,
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/define';
import { GENERATE_PAYMENT_REF } from 'src/constants/universal-identifiers';
import { fillMissingRef } from 'src/lib/generate-ref';
import { CoreDbClient } from 'src/lib/records';
import { makePaymentRef } from 'src/lib/refs';

type PaymentRecord = {
  id: string;
  paymentRef?: string | null;
  protectaRef?: string | null;
};

export const handler = async (
  payload: DatabaseEventPayload<ObjectRecordCreateEvent<PaymentRecord>>,
) =>
  fillMissingRef(new CoreDbClient(), payload.properties.after, {
    objectSingular: 'insurancePayment',
    refField: 'paymentRef',
    makeRef: () => makePaymentRef(),
  });

export default defineLogicFunction({
  universalIdentifier: GENERATE_PAYMENT_REF,
  name: 'generate-payment-ref',
  description:
    'Assigns a payment reference (PAY-XXXXXXXXXX) when a payment is created without one, e.g. from the CRM UI.',
  timeoutSeconds: 10,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'insurancePayment.created',
  },
});
