import {
  defineLogicFunction,
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/define';
import { GEN_ON_DOC_CREATED } from 'src/constants/universal-identifiers';
import { CoreDbClient, type RecordData } from 'src/lib/records';
import { fillGeneratedDocument } from 'src/lib/service-documents';

/**
 * The manual path: staff create a "Generated document" in the CRM and
 * give it a policy number; this fills the reference and content. Records
 * already filled by createGeneratedDocument are left untouched.
 */
export const handler = async (
  payload: DatabaseEventPayload<ObjectRecordCreateEvent<RecordData>>,
) => {
  const record = payload.properties.after;
  const filled = await fillGeneratedDocument(new CoreDbClient(), record);
  return {
    processed: filled !== record,
    reference: filled.reference,
    status: filled.status,
  };
};

export default defineLogicFunction({
  universalIdentifier: GEN_ON_DOC_CREATED,
  name: 'fill-on-document-created',
  description:
    'Fills the document reference and content for manually created document records.',
  timeoutSeconds: 30,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'generatedDocument.created',
  },
});
