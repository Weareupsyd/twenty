import {
  defineLogicFunction,
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/define';
import { GEN_ON_POLICY } from 'src/constants/universal-identifiers';
import { CoreDbClient } from 'src/lib/records';
import { createGeneratedDocument } from 'src/lib/service-documents';

type PolicyRecord = {
  id: string;
  policyNo?: string | null;
};

/**
 * Link to Protecta Bode: whenever a policy is issued anywhere in the
 * workspace (bot, portal, partner API or the CRM), generate its policy
 * document from the installed text template (not the source DOCX layout).
 */
export const handler = async (
  payload: DatabaseEventPayload<ObjectRecordCreateEvent<PolicyRecord>>,
) => {
  const policyNo = String(payload.properties.after.policyNo ?? '').trim();
  if (!policyNo) return { processed: false, reason: 'no policyNo' };
  const document = await createGeneratedDocument(new CoreDbClient(), {
    policyNo,
  });
  return {
    processed: true,
    reference: document.reference,
    status: document.status,
  };
};

export default defineLogicFunction({
  universalIdentifier: GEN_ON_POLICY,
  name: 'generate-on-policy-created',
  description:
    'Generates the text-template policy document when a Protecta policy is created.',
  timeoutSeconds: 30,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'insurancePolicy.created',
  },
});
