import {
  defineLogicFunction,
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/define';
import { SMS_ON_QUOTE } from 'src/constants/universal-identifiers';
import { CoreDbClient, type RecordData } from 'src/lib/records';
import { deliverSms } from 'src/lib/service-sms';

const fmt = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value.toLocaleString('en-US');
  return String(value);
};

/**
 * Notify the customer when a quote is issued anywhere in the workspace
 * (bot, portal, partner API or the CRM). Missing phone or template just
 * skips — an SMS costs money, so nothing is guessed.
 */
export const handler = async (
  payload: DatabaseEventPayload<ObjectRecordCreateEvent<RecordData>>,
) => {
  const quote = payload.properties.after;
  const recipient = String(quote.policyholderPhone ?? '').trim();
  if (!recipient) return { processed: false, reason: 'no policyholderPhone' };
  const outcome = await deliverSms(new CoreDbClient(), {
    recipient,
    eventKey: 'QUOTE_ISSUED',
    variables: {
      reference: fmt(quote.reference),
      premium: fmt(quote.premium),
      plate: fmt(quote.plate),
      validUntil: fmt(quote.validUntil),
      policyholderPhone: recipient,
      shareUrl: fmt(quote.shareUrl),
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
  universalIdentifier: SMS_ON_QUOTE,
  name: 'send-on-quote-created',
  description: 'Sends the QUOTE_ISSUED SMS when a Protecta quote is created.',
  timeoutSeconds: 30,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'insuranceQuote.created',
  },
});
