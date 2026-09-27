import { defineLogicFunction } from 'twenty-sdk/define';
import { RetryableLogicFunctionError } from 'twenty-sdk/logic-function';
import { BOT_INBOUND } from 'src/constants/universal-identifiers';
import { CoreDbClient } from 'src/lib/records';
import { processBotMessage } from 'src/lib/service-bot';
import { type InboundWhatsAppMessage } from 'src/lib/whatsapp-api';

export const handler = async (message: InboundWhatsAppMessage) => {
  try {
    await processBotMessage(new CoreDbClient(), message);
  } catch {
    throw new RetryableLogicFunctionError(
      'WhatsApp message processing failed.',
    );
  }
};
export default defineLogicFunction({
  universalIdentifier: BOT_INBOUND,
  name: 'bot-inbound',
  timeoutSeconds: 60,
  handler,
});
