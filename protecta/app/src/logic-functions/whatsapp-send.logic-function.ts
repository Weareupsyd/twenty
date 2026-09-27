import { defineLogicFunction } from 'twenty-sdk/define';
import { RetryableLogicFunctionError } from 'twenty-sdk/logic-function';
import { WHATSAPP_SEND } from 'src/constants/universal-identifiers';
import { normalizeUgPhone } from 'src/lib/phones';
import { sendWhatsAppText, whatsappConfigFromEnv } from 'src/lib/whatsapp-api';

export const handler = async (payload: { to: string; text: string }) => {
  const config = whatsappConfigFromEnv();
  const phone = normalizeUgPhone(payload.to);
  if (!config) throw new Error('WhatsApp is not configured.');
  if (!phone || !payload.text)
    throw new Error('A valid phone and message are required.');
  try {
    return await sendWhatsAppText(config, phone, payload.text);
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
