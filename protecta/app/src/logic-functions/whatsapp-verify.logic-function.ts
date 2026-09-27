import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { WHATSAPP_VERIFY } from 'src/constants/universal-identifiers';

/**
 * Meta WhatsApp verification handshake (GET on the webhook path).
 * Kept separate from the POST handler because each route binding allows a
 * single HTTP method.
 */
const handler = async (event: RoutePayload): Promise<Response> => {
  const mode = event.queryStringParameters?.['hub.mode'] ?? '';
  const token = event.queryStringParameters?.['hub.verify_token'] ?? '';
  const challenge = event.queryStringParameters?.['hub.challenge'] ?? '';
  const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? '';
  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return Response.json({ ok: false, error: 'Verification failed.' }, { status: 403 });
};

export default defineLogicFunction({
  universalIdentifier: WHATSAPP_VERIFY,
  name: 'whatsapp-verify',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/whatsapp/webhook',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
