import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { HEALTH_CHECK } from 'src/constants/universal-identifiers';
import { jsonResponse } from 'src/lib/http';

const handler = async (_event: RoutePayload): Promise<Response> =>
  jsonResponse({
    ok: true,
    app: 'protecta-bode',
    time: new Date().toISOString(),
    whatsapp: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID),
    momo: Boolean(process.env.MOMO_SUBSCRIPTION_KEY),
    airtel: Boolean(process.env.AIRTEL_CLIENT_ID),
    email: process.env.EMAIL_PROVIDER === 'resend',
  });

export default defineLogicFunction({
  universalIdentifier: HEALTH_CHECK,
  name: 'health',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/health',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
