/**
 * WhatsApp Service - Evolution API integration.
 *
 * Uses the Evolution API (self-hosted WhatsApp gateway) to send:
 *   - Plain text messages
 *   - Link messages with URL previews
 *   - PDF documents (e.g. screening reports)
 *
 * Evolution API endpoints:
 *   POST /message/sendText/{instance}   - send text (with optional linkPreview)
 *   POST /message/sendMedia/{instance}   - send media/documents (URL or base64)
 *
 * Config via env vars:
 *   WHATSAPP_SERVICE_URL   - base URL of the Evolution API (default: http://104.248.16.109:8080)
 *   WHATSAPP_API_KEY       - global API key for the Evolution API (default: WFhUryqpgSYVVgeSHYq6k)
 *   WHATSAPP_INSTANCE      - instance name on the Evolution API (default: "upsyd")
 */

import { logger } from '@/utils/logger.js';
import config from '@/config/index.js';

export interface WhatsAppConfig {
  baseUrl: string;
  apiKey: string;
  instance: string;
}

export interface SendTextOptions {
  number: string;
  text: string;
  linkPreview?: boolean;
  delay?: number;
}

export interface WhatsAppDeliveryResult {
  success: boolean;
  key?: {
    remoteJid?: string;
    fromMe?: boolean;
    id?: string;
  };
  error?: string;
}

/** Default Evolution API configuration. */
const DEFAULT_BASE_URL = 'http://104.248.16.109:8080';
const DEFAULT_API_KEY = 'WFhUryqpgSYVVgeSHYq6k';
const DEFAULT_INSTANCE = 'upsyd';

/**
 * Resolve WhatsApp config from env + defaults.
 */
export function getWhatsAppConfig(): WhatsAppConfig {
  return {
    baseUrl: (process.env.WHATSAPP_SERVICE_URL || config.whatsapp?.serviceUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey: process.env.WHATSAPP_API_KEY || config.whatsapp?.apiKey || DEFAULT_API_KEY,
    instance: process.env.WHATSAPP_INSTANCE || DEFAULT_INSTANCE,
  };
}

/**
 * Build headers for Evolution API requests.
 */
function headers(cfg: WhatsAppConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'apiKey': cfg.apiKey,
  };
}

/**
 * Clean a phone number to the format Evolution API expects
 * (international format without leading +)
 */
function cleanNumber(number: string): string {
  return number.replace(/^\+/, '').replace(/[^0-9]/g, '');
}

/**
 * Send a plain text WhatsApp message.
 * When `linkPreview` is true, Evolution API auto-generates a link preview
 * for URLs in the message text.
 */
export async function sendWhatsAppText(
  cfg: WhatsAppConfig,
  options: SendTextOptions,
): Promise<WhatsAppDeliveryResult> {
  try {
    const number = cleanNumber(options.number);
    const url = cfg.baseUrl + '/message/sendText/' + cfg.instance;

    const body: Record<string, unknown> = {
      number,
      text: options.text,
    };
    if (options.delay && options.delay > 0) body.delay = options.delay;
    if (options.linkPreview) body.linkPreview = true;

    const res = await fetch(url, {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => 'Unknown error');
      logger.error('Evolution API sendText error', {
        status: res.status, body: errBody,
      });
      return { success: false, error: 'HTTP ' + res.status + ': ' + errBody.slice(0, 300) };
    }

    const data = await res.json() as any;
    logger.info('WhatsApp text sent', { number, key: data?.key });
    return { success: true, key: data?.key };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('WhatsApp sendText failed', { error: message });
    return { success: false, error: message };
  }
}

/**
 * Send a text message with a link and auto-generated preview.
 * Evolution API generates the link preview from the URL in the message.
 */
export async function sendWhatsAppLink(
  cfg: WhatsAppConfig,
  number: string,
  url: string,
  caption?: string,
): Promise<WhatsAppDeliveryResult> {
  const text = caption ? caption + '\n\n' + url : url;
  return sendWhatsAppText(cfg, {
    number,
    text,
    linkPreview: true,
  });
}

/**
 * Send a document (PDF) via WhatsApp.
 * The `media` parameter can be a publicly accessible URL or a base64-encoded string.
 */
export async function sendWhatsAppDocument(
  cfg: WhatsAppConfig,
  number: string,
  documentUrl: string,
  fileName: string,
  caption?: string,
): Promise<WhatsAppDeliveryResult> {
  try {
    const clean = cleanNumber(number);
    const url = cfg.baseUrl + '/message/sendMedia/' + cfg.instance;

    const body: Record<string, unknown> = {
      number: clean,
      mediatype: 'document',
      media: documentUrl,
      fileName: fileName,
      mimetype: 'application/pdf',
    };
    if (caption) body.caption = caption;

    const res = await fetch(url, {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => 'Unknown error');
      logger.error('Evolution API sendDocument error', {
        status: res.status, body: errBody,
      });
      return { success: false, error: 'HTTP ' + res.status + ': ' + errBody.slice(0, 300) };
    }

    const data = await res.json() as any;
    logger.info('WhatsApp document sent', { number, fileName, key: data?.key });
    return { success: true, key: data?.key };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('WhatsApp sendDocument failed', { error: message });
    return { success: false, error: message };
  }
}

/**
 * Send a text with link preview, then optionally a PDF document.
 */
export async function sendWhatsAppWithLinkAndDocument(
  cfg: WhatsAppConfig,
  number: string,
  linkUrl: string,
  caption: string,
  documentUrl?: string,
  documentName?: string,
): Promise<{ text: WhatsAppDeliveryResult; document?: WhatsAppDeliveryResult }> {
  const textResult = await sendWhatsAppLink(cfg, number, linkUrl, caption);

  let documentResult: WhatsAppDeliveryResult | undefined;
  if (documentUrl && documentName) {
    documentResult = await sendWhatsAppDocument(cfg, number, documentUrl, documentName, caption);
  }

  return { text: textResult, document: documentResult };
}
