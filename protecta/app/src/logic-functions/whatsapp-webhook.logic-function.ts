import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { enqueueJobs, kv } from 'twenty-sdk/logic-function';
import {
  BOT_INBOUND,
  WHATSAPP_WEBHOOK,
} from 'src/constants/universal-identifiers';
import { headerValue } from 'src/lib/auth-partner';
import { hmacSha256Hex, sha256Hex, signaturesEqual } from 'src/lib/crypto';
import {
  evolutionWebhookAuthorized,
  isEvolutionPayload,
  parseEvolutionInbound,
} from 'src/lib/evolution-api';
import { jsonResponse, parseJsonBody } from 'src/lib/http';
import { parseMetaInbound } from 'src/lib/whatsapp-api';
import {
  loadStoredWhatsAppSettings,
  resolveEvolutionConfig,
} from 'src/lib/whatsapp-settings';

const enqueue = (messages: { id: string; from: string; text: string; timestamp: string }[]) =>
  enqueueJobs({
    logicFunctionUniversalIdentifier: BOT_INBOUND,
    retryLimit: 5,
    jobs: messages.map((message) => ({
      jobId: `wa-${sha256Hex(message.id)}`,
      payload: { ...message },
    })),
  });

export const handler = async (event: RoutePayload) => {
  const raw = event.rawBody ?? (typeof event.body === 'string' ? event.body : '');
  let parsed: unknown = event.body;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = event.body;
    }
  } else if (!parsed) {
    parsed = parseJsonBody(event);
  }

  const evolution = await resolveEvolutionConfig(kv);
  if (isEvolutionPayload(parsed)) {
    if (!evolution) {
      return jsonResponse(
        { ok: false, error: 'Evolution API is not connected.' },
        503,
      );
    }
    if (!evolutionWebhookAuthorized(event.headers, parsed, evolution)) {
      return jsonResponse({ ok: false, error: 'Invalid Evolution API key.' }, 401);
    }
    const incoming = parseEvolutionInbound(parsed);
    if (incoming.length) {
      await enqueue(incoming);
    }
    return jsonResponse({ ok: true, received: incoming.length, provider: 'evolution' });
  }

  const saved = await loadStoredWhatsAppSettings(kv);
  const secret = saved?.metaAppSecret || process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    return jsonResponse(
      { ok: false, error: 'Webhook verification is not configured.' },
      503,
    );
  }
  if (
    !event.rawBody ||
    !signaturesEqual(
      headerValue(event.headers, 'x-hub-signature-256'),
      `sha256=${hmacSha256Hex(secret, event.rawBody)}`,
    )
  ) {
    return jsonResponse({ ok: false, error: 'Invalid signature.' }, 401);
  }
  let incoming;
  try {
    incoming = parseMetaInbound(JSON.parse(event.rawBody));
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid webhook payload.' }, 400);
  }
  if (incoming.length) {
    await enqueue(incoming);
  }
  return jsonResponse({ ok: true, received: incoming.length, provider: 'meta' });
};

export default defineLogicFunction({
  universalIdentifier: WHATSAPP_WEBHOOK,
  name: 'whatsapp-webhook',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/whatsapp/webhook',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-hub-signature-256', 'apikey'],
  },
});
