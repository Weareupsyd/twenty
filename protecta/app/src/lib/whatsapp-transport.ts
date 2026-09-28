import { kv } from 'twenty-sdk/logic-function';
import { sendEvolutionText } from 'src/lib/evolution-api';
import { type StateStore } from 'src/lib/service-otp';
import { sendWhatsAppText } from 'src/lib/whatsapp-api';
import {
  resolveEvolutionConfig,
  resolveMetaConfig,
} from 'src/lib/whatsapp-settings';

export type WhatsAppSender = (
  to: string,
  text: string,
) => Promise<{ messageId: string | null }>;

export const NOT_CONFIGURED =
  'WhatsApp is not connected. Open Settings → WhatsApp bot and connect the Evolution API instance.';

export const deliverWhatsAppText = async (
  to: string,
  text: string,
  store: Pick<StateStore, 'get'> = kv,
): Promise<{ messageId: string | null }> => {
  const evolution = await resolveEvolutionConfig(store);
  if (evolution) {
    return sendEvolutionText(evolution, to, text);
  }
  const meta = await resolveMetaConfig(store);
  if (meta) {
    return sendWhatsAppText(meta, to, text);
  }
  throw new Error(NOT_CONFIGURED);
};

export const whatsAppSender = async (
  store: Pick<StateStore, 'get'> = kv,
): Promise<WhatsAppSender | null> => {
  const evolution = await resolveEvolutionConfig(store);
  if (evolution) {
    return (to, text) => sendEvolutionText(evolution, to, text);
  }
  const meta = await resolveMetaConfig(store);
  if (!meta) {
    return null;
  }
  return (to, text) => sendWhatsAppText(meta, to, text);
};
