import {
  defineLogicFunction,
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/define';
import { SMS_ON_SMS_CREATED } from 'src/constants/universal-identifiers';
import { CoreDbClient, type RecordData } from 'src/lib/records';
import { fillSmsMessage } from 'src/lib/service-sms';

/**
 * The manual path: staff create an "Sms message" in the CRM with an
 * event key and recipient; this fills the reference and message and
 * sends it. Records created with a message already filled (the automatic
 * path) are left untouched — that is what prevents double sends.
 */
export const handler = async (
  payload: DatabaseEventPayload<ObjectRecordCreateEvent<RecordData>>,
) => {
  const record = payload.properties.after;
  const filled = await fillSmsMessage(new CoreDbClient(), record);
  return {
    processed: filled !== record,
    reference: filled.reference,
    status: filled.status,
  };
};

export default defineLogicFunction({
  universalIdentifier: SMS_ON_SMS_CREATED,
  name: 'fill-on-message-created',
  description:
    'Fills the reference and message and sends manually created Sms message records.',
  timeoutSeconds: 30,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'smsMessage.created',
  },
});
