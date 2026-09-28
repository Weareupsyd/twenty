import {
  defineLogicFunction,
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/define';
import { SMS_ON_POLICY } from 'src/constants/universal-identifiers';
import { CoreDbClient, type RecordData } from 'src/lib/records';
import { deliverSms } from 'src/lib/service-sms';

const fmt = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value.toLocaleString('en-US');
  return String(value);
};

/**
 * Notify the customer when a policy is issued anywhere in the workspace.
 * The recipient is the phone on the originating quote.
 */
export const handler = async (
  payload: DatabaseEventPayload<ObjectRecordCreateEvent<RecordData>>,
) => {
  const policy = payload.properties.after;
  const policyNo = String(policy.policyNo ?? '').trim();
  const quoteRef = String(policy.quoteRef ?? '').trim();
  if (!policyNo) return { processed: false, reason: 'no policyNo' };

  const db = new CoreDbClient();
  let recipient = '';
  if (quoteRef) {
    const quote = await db.findFirst(
      'insuranceQuotes',
      { reference: { eq: quoteRef } },
      ['policyholderPhone'],
    );
    recipient = String(quote?.policyholderPhone ?? '').trim();
  }
  if (!recipient) return { processed: false, reason: 'no policyholderPhone' };

  const outcome = await deliverSms(db, {
    recipient,
    eventKey: 'POLICY_ISSUED',
    variables: {
      policyNo,
      quoteRef,
      premiumUgx: fmt(policy.premiumUgx),
      plate: fmt(policy.plate),
      periodStart: fmt(policy.periodStart),
      periodEnd: fmt(policy.periodEnd),
    },
  });
  return {
    processed: outcome.outcome === 'SENT',
    outcome: outcome.outcome,
    reference: outcome.record?.reference ?? '',
    error: outcome.error ?? '',
  };
};

export default defineLogicFunction({
  universalIdentifier: SMS_ON_POLICY,
  name: 'send-on-policy-created',
  description: 'Sends the POLICY_ISSUED SMS when a Protecta policy is created.',
  timeoutSeconds: 30,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'insurancePolicy.created',
  },
});
