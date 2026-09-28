import { defineLogicFunction } from 'twenty-sdk/define';
import { RetryableLogicFunctionError } from 'twenty-sdk/logic-function';
import { WHATSAPP_SEND } from 'src/constants/universal-identifiers';
import { normalizeUgPhone } from 'src/lib/phones';
import { deliverWhatsAppText } from 'src/lib/whatsapp-transport';

export const handler = async (payload: { to: string; text: string }) => {
  const phone = normalizeUgPhone(payload.to);
  if (!phone || !payload.text)
    throw new Error('A valid phone and message are required.');
  try {
    return await deliverWhatsAppText(phone, payload.text);
  } catch {
    throw new RetryableLogicFunctionError('WhatsApp delivery failed.');
  }
};
export default defineLogicFunction({
  universalIdentifier: WHATSAPP_SEND,
  name: 'whatsapp-send',
  timeoutSeconds: 30,
  handler,
});
