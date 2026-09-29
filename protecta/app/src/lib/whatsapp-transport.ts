import { kv } from 'twenty-sdk/logic-function';
import {
  sendEvolutionDocument,
  sendEvolutionText,
} from 'src/lib/evolution-api';
import { type StateStore } from 'src/lib/service-otp';
import {
  sendWhatsAppDocument,
  sendWhatsAppText,
} from 'src/lib/whatsapp-api';
import {
  resolveEvolutionConfig,
  resolveMetaConfig,
} from 'src/lib/whatsapp-settings';

export type WhatsAppSender = (
  to: string,
  text: string,
) => Promise<{ messageId: string | null }>;

export type OutboundWhatsAppDocument = {
  fileName: string;
  caption: string;
  base64: string;
  mimeType: string;
};

export type WhatsAppDocSender = (
  to: string,
  doc: OutboundWhatsAppDocument,
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

/**
 * Document (PDF) sender for the conversation: Evolution first, Meta Cloud
 * API as fallback. Returns null when WhatsApp is not configured at all —
 * callers then skip the attachment instead of failing the text reply.
 */
export const whatsAppDocSender = async (
  store: Pick<StateStore, 'get'> = kv,
): Promise<WhatsAppDocSender | null> => {
  const evolution = await resolveEvolutionConfig(store);
  if (evolution) {
    return (to, doc) => sendEvolutionDocument(evolution, to, doc);
  }
  const meta = await resolveMetaConfig(store);
  if (!meta) {
    return null;
  }
  return (to, doc) => sendWhatsAppDocument(meta, to, doc);
};
