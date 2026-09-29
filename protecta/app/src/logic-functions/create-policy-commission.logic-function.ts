import {
  defineLogicFunction,
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/define';
import { AUTO_CREATE_POLICY_COMMISSION } from 'src/constants/universal-identifiers';
import { CoreDbClient } from 'src/lib/records';
import { ensurePolicyCommission } from 'src/lib/service-policies';

export type PolicyCommissionRecord = {
  id: string;
  policyNo?: string | null;
  premiumUgx?: number | null;
  agentId?: string | null;
};

export const handler = async (
  payload: DatabaseEventPayload<
    ObjectRecordCreateEvent<PolicyCommissionRecord>
  >,
) => {
  const db = new CoreDbClient();
  const eventRecord = payload.properties.after;
  const policy = await db.findFirst(
    'insurancePolicies',
    { id: { eq: eventRecord.id } },
    ['policyNo', 'premiumUgx', 'agentId'],
  );
  return policy ? ensurePolicyCommission(db, policy) : null;
};

export default defineLogicFunction({
  universalIdentifier: AUTO_CREATE_POLICY_COMMISSION,
  name: 'create-policy-commission',
  description:
    'Accrues the agent commission when an insurance policy with an assigned agent is created.',
  timeoutSeconds: 20,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'insurancePolicy.created',
  },
});
