export type WhatsAppConfig = {
  token: string;
  phoneId: string;
};

export const whatsappConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): WhatsAppConfig | null => {
  const token = env.WHATSAPP_TOKEN;
  const phoneId = env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) {
    return null;
  }
  return { token, phoneId };
};

export const sendWhatsAppText = async (
  config: WhatsAppConfig,
  to: string,
  text: string,
): Promise<{ messageId: string | null }> => {
  const response = await fetch(
    `https://graph.facebook.com/v21.0/${config.phoneId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/^\+/, ''),
        type: 'text',
        text: { preview_url: true, body: text.slice(0, 4000) },
      }),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`WhatsApp send failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await response.json().catch(() => null)) as {
    messages?: { id?: string }[];
  } | null;
  return { messageId: data?.messages?.[0]?.id ?? null };
};

export type InboundWhatsAppMessage = {
  from: string;
  text: string;
  id: string;
  timestamp: string;
};

type MetaPayload = {
  entry?: {
    changes?: {
      value?: {
        messages?: {
          from?: string;
          id?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: {
            type?: string;
            button_reply?: { title?: string };
            list_reply?: { title?: string };
          };
        }[];
      };
    }[];
  }[];
};

export const parseMetaInbound = (payload: unknown): InboundWhatsAppMessage[] => {
  const out: InboundWhatsAppMessage[] = [];
  const data = payload as MetaPayload | null;
  for (const entry of data?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (!message.from || !message.id) {
          continue;
        }
        let text = '';
        if (message.type === 'text') {
          text = message.text?.body ?? '';
        } else if (message.type === 'button') {
          text = message.button?.text ?? '';
        } else if (message.type === 'interactive') {
          text =
            message.interactive?.button_reply?.title ??
            message.interactive?.list_reply?.title ??
            '';
        } else {
          continue;
        }
        if (!text.trim()) {
          continue;
        }
        out.push({
          from: message.from.startsWith('+') ? message.from : `+${message.from}`,
          text: text.trim(),
          id: message.id,
          timestamp: message.timestamp ?? '',
        });
      }
    }
  }
  return out;
};
