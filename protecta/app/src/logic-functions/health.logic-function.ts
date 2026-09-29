import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { HEALTH_CHECK } from 'src/constants/universal-identifiers';
import { jsonResponse } from 'src/lib/http';
import { evolutionConfigFromEnv, getDefaultEvolutionWebhookUrl } from 'src/lib/evolution-api';

const handler = async (_event: RoutePayload): Promise<Response> =>
  jsonResponse({
    ok: true,
    app: 'protecta-bode',
    time: new Date().toISOString(),
    publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://protectabode.weareupsyd.com',
    webhook: {
      default: 'https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook',
      local: '/s/protecta/whatsapp/webhook',
      full: `${process.env.PUBLIC_BASE_URL || 'https://protectabode.weareupsyd.com'}/s/protecta/whatsapp/webhook`,
      effective: getDefaultEvolutionWebhookUrl(),
      evolutionGlobal: process.env.WEBHOOK_GLOBAL_URL || process.env.EVOLUTION_WEBHOOK_URL || 'https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook',
      seededInTwentyCRM: 'https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook (EVOLUTION_WEBHOOK_URL application variable + PUBLIC_BASE_URL)',
    },
    caddy: {
      domain: 'protectabode.weareupsyd.com',
      evolutionDomain: 'evolution.protectabode.weareupsyd.com',
      config: 'protecta/Caddyfile',
      compose: 'protecta/docker-compose.caddy.yml',
    },
    whatsapp: Boolean(
      evolutionConfigFromEnv() ||
        (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID),
    ),
    whatsappProvider: evolutionConfigFromEnv()
      ? 'evolution'
      : process.env.WHATSAPP_TOKEN
        ? 'meta'
        : 'none',
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
