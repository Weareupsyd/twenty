import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { enqueueJobs } from 'twenty-sdk/logic-function';
import {
  BOT_INBOUND,
  WHATSAPP_WEBHOOK,
} from 'src/constants/universal-identifiers';
import { headerValue } from 'src/lib/auth-partner';
import { hmacSha256Hex, sha256Hex, signaturesEqual } from 'src/lib/crypto';
import { jsonResponse } from 'src/lib/http';
import { parseMetaInbound } from 'src/lib/whatsapp-api';

export const handler = async (event: RoutePayload) => {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret)
    return jsonResponse(
      { ok: false, error: 'Webhook verification is not configured.' },
      503,
    );
  // Meta signs the exact bytes. Never reconstruct them from a parsed object.
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
    await enqueueJobs({
      logicFunctionUniversalIdentifier: BOT_INBOUND,
      retryLimit: 5,
      jobs: incoming.map((message) => ({
        jobId: `wa-${sha256Hex(message.id)}`,
        payload: { ...message },
      })),
    });
  }
  return jsonResponse({ ok: true, received: incoming.length });
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
    forwardedRequestHeaders: ['x-hub-signature-256'],
  },
});
