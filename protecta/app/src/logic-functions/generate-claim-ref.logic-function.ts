import {
  defineLogicFunction,
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/define';
import { GENERATE_CLAIM_REF } from 'src/constants/universal-identifiers';
import { fillMissingRef } from 'src/lib/generate-ref';
import { CoreDbClient } from 'src/lib/records';
import { makeClaimRef } from 'src/lib/refs';

type ClaimRecord = {
  id: string;
  claimRef?: string | null;
  protectaRef?: string | null;
};

export const handler = async (
  payload: DatabaseEventPayload<ObjectRecordCreateEvent<ClaimRecord>>,
) =>
  fillMissingRef(new CoreDbClient(), payload.properties.after, {
    objectSingular: 'insuranceClaim',
    refField: 'claimRef',
    makeRef: () => makeClaimRef(),
  });

export default defineLogicFunction({
  universalIdentifier: GENERATE_CLAIM_REF,
  name: 'generate-claim-ref',
  description:
    'Assigns a claim reference (CLM-XXXXXXXX) when a claim is created without one, e.g. from the CRM UI.',
  timeoutSeconds: 10,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'insuranceClaim.created',
  },
});
