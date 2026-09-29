import {
  defineLogicFunction,
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/define';
import { DELIVER_POLICY_DOCUMENT } from 'src/constants/universal-identifiers';
import { deliverPolicyDocument } from 'src/lib/policy-delivery';
import { CoreDbClient } from 'src/lib/records';

type PolicyRecord = { id: string; policyNo?: string | null };

/**
 * When a policy is issued (payment fully confirmed), send the buyer the
 * final policy document built from the Liberty template, on WhatsApp and
 * by email.
 */
export const handler = async (
  payload: DatabaseEventPayload<ObjectRecordCreateEvent<PolicyRecord>>,
) => {
  const db = new CoreDbClient();
  let policyNo = String(payload.properties.after.policyNo ?? '').trim();
  // The policy number is filled by a sibling trigger; re-read if needed.
  for (let i = 0; !policyNo && i < 5; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const row = await db.findFirst(
      'insurancePolicies',
      { id: { eq: payload.properties.after.id } },
      ['policyNo'],
    );
    policyNo = String(row?.policyNo ?? '').trim();
  }
  if (!policyNo) return { processed: false, reason: 'no policyNo' };
  const result = await deliverPolicyDocument(db, policyNo);
  if (result?.errors.length) console.error('policy delivery', result);
  return { processed: true, ...result };
};

export default defineLogicFunction({
  universalIdentifier: DELIVER_POLICY_DOCUMENT,
  name: 'deliver-policy-document',
  description:
    'Generates the final policy document and sends it to the buyer on WhatsApp and email once a policy is issued.',
  timeoutSeconds: 90,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'insurancePolicy.created',
  },
});
