import {
  defineLogicFunction,
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/define';
import { SMS_ON_CLAIM } from 'src/constants/universal-identifiers';
import { CoreDbClient, type RecordData } from 'src/lib/records';
import { deliverSms } from 'src/lib/service-sms';

const fmt = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value);
};

/**
 * Notify the reporter when a claim is created anywhere in the workspace.
 */
export const handler = async (
  payload: DatabaseEventPayload<ObjectRecordCreateEvent<RecordData>>,
) => {
  const claim = payload.properties.after;
  const recipient = String(claim.reporterPhone ?? '').trim();
  if (!recipient) return { processed: false, reason: 'no reporterPhone' };
  const outcome = await deliverSms(new CoreDbClient(), {
    recipient,
    eventKey: 'claim_created',
    variables: {
      claimRef: fmt(claim.claimRef),
      policyNo: fmt(claim.policyNo),
      status: fmt(claim.status),
      reporterPhone: recipient,
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
  universalIdentifier: SMS_ON_CLAIM,
  name: 'send-on-claim-created',
  description: 'Sends the claim_created SMS when a Protecta claim is created.',
  timeoutSeconds: 30,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'insuranceClaim.created',
  },
});
