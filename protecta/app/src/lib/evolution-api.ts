import { headerValue } from 'src/lib/auth-partner';
import { signaturesEqual } from 'src/lib/crypto';
import { normalizeUgPhone } from 'src/lib/phones';
import { type InboundWhatsAppMessage } from 'src/lib/whatsapp-api';

export type EvolutionConfig = {
  baseUrl: string;
  instance: string;
  apiKey: string;
};

export const evolutionConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): EvolutionConfig | null => {
  const baseUrl = env.EVOLUTION_API_URL?.trim() ?? '';
  const instance = env.EVOLUTION_INSTANCE?.trim() ?? '';
  const apiKey = env.EVOLUTION_API_KEY?.trim() ?? '';
  if (!baseUrl || !instance || !apiKey) {
    return null;
  }
  return { baseUrl, instance, apiKey };
};

export const getDefaultEvolutionWebhookUrl = (
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const explicit =
    env.EVOLUTION_WEBHOOK_URL?.trim() ||
    env.WEBHOOK_GLOBAL_URL?.trim() ||
    '';
  if (explicit) return explicit.replace(/\/$/, '');
  const publicBase = (env.PUBLIC_BASE_URL?.trim() || '').replace(/\/$/, '');
  if (publicBase) return `${publicBase}/s/protecta/whatsapp/webhook`;
  return 'https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook';
};

const endpoint = (config: EvolutionConfig, path: string): string =>
  `${config.baseUrl.replace(/\/$/, '')}${path}`;

const evolutionHeaders = (config: EvolutionConfig): Record<string, string> => ({
  apikey: config.apiKey,
  'Content-Type': 'application/json',
});

export const sendEvolutionText = async (
  config: EvolutionConfig,
  to: string,
  text: string,
): Promise<{ messageId: string | null }> => {
  const number = to.replace(/^\+/, '');
  const response = await fetch(
    endpoint(
      config,
      `/message/sendText/${encodeURIComponent(config.instance)}`,
    ),
    {
      method: 'POST',
      headers: evolutionHeaders(config),
      body: JSON.stringify({ number, text: text.slice(0, 4000) }),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Evolution send failed (${response.status}): ${detail.slice(0, 200)}`,
    );
  }
  const data = (await response.json().catch(() => null)) as {
    key?: { id?: string };
    messageId?: string;
  } | null;
  return { messageId: data?.key?.id ?? data?.messageId ?? null };
};

export type EvolutionConnection = {
  ok: boolean;
  state: string;
  detail: string;
};

export const evolutionConnectionState = async (
  config: EvolutionConfig,
): Promise<EvolutionConnection> => {
  const response = await fetch(
    endpoint(
      config,
      `/instance/connectionState/${encodeURIComponent(config.instance)}`,
    ),
    { headers: { apikey: config.apiKey } },
  );
  const detail = await response.text().catch(() => '');
  if (!response.ok) {
    return {
      ok: false,
      state: 'error',
      detail: detail.slice(0, 240) || `HTTP ${response.status}`,
    };
  }
  let state = 'unknown';
  try {
    const parsed = JSON.parse(detail) as {
      instance?: { state?: string };
      state?: string;
    };
    state = parsed.instance?.state ?? parsed.state ?? 'unknown';
  } catch {
    state = 'unknown';
  }
  return {
    ok: state === 'open',
    state,
    detail: state === 'open' ? 'WhatsApp session is connected.' : detail.slice(0, 240),
  };
};

export const setEvolutionWebhook = async (
  config: EvolutionConfig,
  webhookUrl: string,
): Promise<{ ok: boolean; detail: string }> => {
  const response = await fetch(
    endpoint(config, `/webhook/set/${encodeURIComponent(config.instance)}`),
    {
      method: 'POST',
      headers: evolutionHeaders(config),
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: webhookUrl,
          byEvents: false,
          base64: false,
          headers: { apikey: config.apiKey },
          events: ['MESSAGES_UPSERT'],
        },
      }),
    },
  );
  const detail = await response.text().catch(() => '');
  if (!response.ok) {
    return {
      ok: false,
      detail: detail.slice(0, 240) || `HTTP ${response.status}`,
    };
  }
  return { ok: true, detail: 'Webhook registered on the Evolution instance.' };
};

const messageText = (message: Record<string, unknown> | undefined): string => {
  if (!message) {
    return '';
  }
  const extended = message.extendedTextMessage as { text?: string } | undefined;
  const button = message.buttonsResponseMessage as
    | { selectedDisplayText?: string }
    | undefined;
  const list = message.listResponseMessage as { title?: string } | undefined;
  const template = message.templateButtonReplyMessage as
    | { selectedDisplayText?: string }
    | undefined;
  const ephemeral = message.ephemeralMessage as
    | { message?: Record<string, unknown> }
    | undefined;
  return String(
    message.conversation ??
      extended?.text ??
      button?.selectedDisplayText ??
      list?.title ??
      template?.selectedDisplayText ??
      ephemeral?.message?.conversation ??
      '',
  ).trim();
};

const jidToPhone = (jid: string | undefined): string | null => {
  if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') {
    return null;
  }
  const local = jid.split('@')[0] ?? '';
  return normalizeUgPhone(local) ?? (local ? normalizeUgPhone(`+${local}`) : null);
};

type EvolutionRow = {
  key?: {
    remoteJid?: string;
    remoteJidAlt?: string;
    fromMe?: boolean;
    id?: string;
  };
  message?: Record<string, unknown>;
  messageTimestamp?: number | string;
};

export const isEvolutionPayload = (payload: unknown): boolean => {
  const data = payload as { event?: string; data?: unknown; entry?: unknown } | null;
  if (!data || typeof data !== 'object' || data.entry) {
    return false;
  }
  const event = String(data.event ?? '').toLowerCase();
  if (event.includes('message')) {
    return true;
  }
  const row = (Array.isArray(data.data) ? data.data[0] : data.data) as
    | EvolutionRow
    | undefined;
  return Boolean(row?.key?.remoteJid || row?.key?.id);
};

export const evolutionWebhookAuthorized = (
  headers: Record<string, string | undefined> | undefined,
  payload: unknown,
  config: EvolutionConfig,
): boolean => {
  const headerKey = headerValue(headers, 'apikey');
  const bodyKey =
    typeof (payload as { apikey?: unknown } | null)?.apikey === 'string'
      ? (payload as { apikey: string }).apikey
      : '';
  return (
    (headerKey.length > 0 && signaturesEqual(headerKey, config.apiKey)) ||
    (bodyKey.length > 0 && signaturesEqual(bodyKey, config.apiKey))
  );
};

export const parseEvolutionInbound = (
  payload: unknown,
): InboundWhatsAppMessage[] => {
  const data = payload as { event?: string; data?: unknown } | null;
  const event = String(data?.event ?? '')
    .toLowerCase()
    .replace(/_/g, '.');
  if (event && !event.includes('messages.upsert') && !event.includes('message')) {
    return [];
  }
  const rows = (
    Array.isArray(data?.data) ? data?.data : data?.data ? [data.data] : []
  ) as EvolutionRow[];
  const out: InboundWhatsAppMessage[] = [];
  for (const row of rows) {
    if (row.key?.fromMe) {
      continue;
    }
    const phone =
      jidToPhone(row.key?.remoteJid) ?? jidToPhone(row.key?.remoteJidAlt);
    const text = messageText(row.message);
    if (!phone || !row.key?.id || !text) {
      continue;
    }
    out.push({
      from: phone,
      text,
      id: row.key.id,
      timestamp: String(row.messageTimestamp ?? ''),
    });
  }
  return out;
};
