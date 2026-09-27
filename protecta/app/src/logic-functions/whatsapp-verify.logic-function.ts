import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { jsonResponse } from 'src/lib/http';
import { WHATSAPP_VERIFY_HANDLER } from 'src/constants/universal-identifiers';

/**
 * Meta WhatsApp verification handshake (GET on the webhook path).
 * Kept separate from the POST handler because each route binding allows a
 * single HTTP method.
 */
export const handler = async (event: RoutePayload): Promise<Response> => {
  const mode = event.queryStringParameters?.['hub.mode'] ?? '';
  const token = event.queryStringParameters?.['hub.verify_token'] ?? '';
  const challenge = event.queryStringParameters?.['hub.challenge'] ?? '';
  const expected = process.env.WHATSAPP_VERIFY ?? '';
  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return jsonResponse({ ok: false, error: 'Verification failed.' }, 403);
};

export default defineLogicFunction({
  universalIdentifier: WHATSAPP_VERIFY_HANDLER,
  name: 'whatsapp-verify',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/whatsapp/webhook',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
