import {
  defineLogicFunction,
  type DatabaseEventPayload,
  type ObjectRecordUpdateEvent,
} from 'twenty-sdk/define';
import { CREATE_POLICY_COMMISSION_ON_UPDATE } from 'src/constants/universal-identifiers';
import { CoreDbClient } from 'src/lib/records';
import { ensurePolicyCommission } from 'src/lib/service-policies';

type PolicyCommissionRecord = {
  id: string;
  policyNo?: string | null;
  premiumUgx?: number | null;
  agentId?: string | null;
};

export const handler = async (
  payload: DatabaseEventPayload<
    ObjectRecordUpdateEvent<PolicyCommissionRecord>
  >,
) => {
  // This covers agent assignment after the policy was first created in the
  // CRM and back-end updates made by integrations or the issuance flow.
  const db = new CoreDbClient();
  const eventRecord = payload.properties.after;
  const policyId = String(eventRecord?.id ?? '');
  if (!policyId) return null;
  const policy = await db.findFirst(
    'insurancePolicies',
    { id: { eq: policyId } },
    ['policyNo', 'premiumUgx', 'agentId'],
  );
  return policy ? ensurePolicyCommission(db, policy) : null;
};

export default defineLogicFunction({
  universalIdentifier: CREATE_POLICY_COMMISSION_ON_UPDATE,
  name: 'create-policy-commission-on-update',
  description:
    'Creates a commission when agent, premium, or policy details are added or updated.',
  timeoutSeconds: 20,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'insurancePolicy.updated',
  },
});
