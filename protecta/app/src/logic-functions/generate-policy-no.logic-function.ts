import {
  defineLogicFunction,
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/define';
import { GENERATE_POLICY_NO } from 'src/constants/universal-identifiers';
import { fillMissingRef } from 'src/lib/generate-ref';
import { CoreDbClient } from 'src/lib/records';
import { makePolicyNo } from 'src/lib/refs';

type PolicyRecord = {
  id: string;
  policyNo?: string | null;
  protectaRef?: string | null;
};

export const handler = async (
  payload: DatabaseEventPayload<ObjectRecordCreateEvent<PolicyRecord>>,
) =>
  fillMissingRef(new CoreDbClient(), payload.properties.after, {
    objectSingular: 'insurancePolicy',
    refField: 'policyNo',
    makeRef: () => makePolicyNo(),
  });

export default defineLogicFunction({
  universalIdentifier: GENERATE_POLICY_NO,
  name: 'generate-policy-no',
  description:
    'Assigns a policy number (PB-YYYY-XXXXXX) when a policy is created without one, e.g. from the CRM UI.',
  timeoutSeconds: 10,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'insurancePolicy.created',
  },
});
