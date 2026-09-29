import { type StateStore } from 'src/lib/service-otp';
import {
  evolutionConnectionState,
  evolutionConfigFromEnv,
  setEvolutionWebhook,
  type EvolutionConfig,
} from 'src/lib/evolution-api';
import { whatsappConfigFromEnv } from 'src/lib/whatsapp-api';
import {
  DEFAULT_BOT_MENU,
  loadStoredWhatsAppSettings,
  maskSecret,
  WHATSAPP_SETTINGS_KEY,
  type BotMenuItem,
  type StoredWhatsAppSettings,
  type WhatsAppProvider,
} from 'src/lib/whatsapp-settings';

export const BOT_ROUTES = [
  '1. Calculate premium — send the car value, get the premium',
  '2. Get cover — make, model, year, plate and name, same as the website',
  '3. My policies',
  '4. Pay for a quote',
  '5. Report a claim',
  '6. Talk to support',
];

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const isWebhookUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.pathname.replace(/\/$/, '').endsWith('/s/protecta/whatsapp/webhook')
    );
  } catch {
    return false;
  }
};

const normalizeBotMenu = (raw: unknown, fallback: BotMenuItem[]): BotMenuItem[] => {
  if (!Array.isArray(raw)) return fallback;
  return raw
    .map((item: any) => ({
      id: String(item.id ?? '').trim() || Math.random().toString(36).slice(2, 8),
      label: String(item.label ?? '').trim().slice(0, 80),
      description: String(item.description ?? '').trim().slice(0, 200),
      enabled: item.enabled !== false,
    }))
    .filter((i: BotMenuItem) => i.label.length > 0)
    .slice(0, 12);
};

export const whatsAppSettingsView = async (
  store: Pick<StateStore, 'get'>,
) => {
  const saved = await loadStoredWhatsAppSettings(store);
  const envEvolution = evolutionConfigFromEnv();
  const envMeta = whatsappConfigFromEnv();
  const provider: WhatsAppProvider =
    saved?.provider ?? (envEvolution ? 'evolution' : envMeta ? 'meta' : 'evolution');
  const baseUrl = saved?.evolutionBaseUrl || envEvolution?.baseUrl || '';
  const instance = saved?.evolutionInstance || envEvolution?.instance || '';
  const apiKey = saved?.evolutionApiKey || envEvolution?.apiKey || '';
  const botMenu = saved?.botMenu && saved.botMenu.length > 0 ? saved.botMenu : DEFAULT_BOT_MENU;
  const welcomeMessage = saved?.botWelcomeMessage || 'Protecta Bode — Cover Your Ride, Cover Your Life';
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const evolutionWebhookEnv = (process.env.EVOLUTION_WEBHOOK_URL || process.env.WEBHOOK_GLOBAL_URL || '').replace(/\/$/, '');
  const defaultWebhook = 'https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook';
  const webhookFromPublicBase = publicBaseUrl ? `${publicBaseUrl}/s/protecta/whatsapp/webhook` : '';
  const effectiveWebhook = evolutionWebhookEnv || webhookFromPublicBase || defaultWebhook;
  return {
    ok: true,
    provider,
    webhookPath: '/s/protecta/whatsapp/webhook',
    webhookUrlDefault: defaultWebhook,
    webhookUrlFromPublicBase: webhookFromPublicBase,
    webhookUrlEnv: evolutionWebhookEnv,
    webhookUrlEffective: effectiveWebhook,
    publicBaseUrl: publicBaseUrl || defaultWebhook.replace('/s/protecta/whatsapp/webhook', ''),
    botRoutes: BOT_ROUTES,
    botMenu,
    welcomeMessage,
    evolution: {
      baseUrl,
      instance,
      apiKeySet: Boolean(apiKey),
      apiKeyHint: maskSecret(apiKey),
      source: saved?.evolutionApiKey ? 'settings' : envEvolution ? 'environment' : 'none',
    },
    meta: {
      phoneId: saved?.metaPhoneId || envMeta?.phoneId || '',
      tokenSet: Boolean(saved?.metaToken || envMeta?.token),
      tokenHint: maskSecret(saved?.metaToken || envMeta?.token),
      appSecretSet: Boolean(saved?.metaAppSecret || process.env.WHATSAPP_APP_SECRET),
      verifyTokenSet: Boolean(saved?.metaVerifyToken || process.env.WHATSAPP_VERIFY),
    },
  };
};

export const saveWhatsAppSettings = async (
  store: StateStore,
  body: Record<string, unknown>,
): Promise<{
  ok: boolean;
  error?: string;
  saved?: boolean;
  connection?: { ok: boolean; state: string; detail: string };
  webhook?: { ok: boolean; detail: string };
}> => {
  const previous = await loadStoredWhatsAppSettings(store);
  const provider = clean(body.provider) === 'meta' ? 'meta' : 'evolution';
  const botMenuRaw = (body as any).botMenu;
  const welcomeRaw = clean((body as any).welcomeMessage);
  const normalizedMenu = botMenuRaw ? normalizeBotMenu(botMenuRaw, previous?.botMenu || DEFAULT_BOT_MENU) : previous?.botMenu;
  const next: StoredWhatsAppSettings = {
    provider,
    evolutionBaseUrl: clean(body.baseUrl) || previous?.evolutionBaseUrl || '',
    evolutionInstance: clean(body.instance) || previous?.evolutionInstance || '',
    evolutionApiKey: clean(body.apiKey) || previous?.evolutionApiKey || '',
    metaToken: clean(body.metaToken) || previous?.metaToken || '',
    metaPhoneId: clean(body.metaPhoneId) || previous?.metaPhoneId || '',
    metaAppSecret: clean(body.metaAppSecret) || previous?.metaAppSecret || '',
    metaVerifyToken: clean(body.metaVerifyToken) || previous?.metaVerifyToken || '',
    botMenu: normalizedMenu,
    botWelcomeMessage: welcomeRaw || previous?.botWelcomeMessage || 'Protecta Bode — Cover Your Ride, Cover Your Life',
  };
  // Allow saving bot menu without requiring evolution credentials
  const isOnlyBotMenuUpdate = Boolean(botMenuRaw || welcomeRaw) && !body.baseUrl && !body.instance && !body.apiKey && !body.connect;
  if (!isOnlyBotMenuUpdate && provider === 'evolution' && (!next.evolutionBaseUrl || !next.evolutionInstance || !next.evolutionApiKey)) {
    const env = evolutionConfigFromEnv();
    if (!env) {
      return {
        ok: false,
        error: 'Evolution API needs a base URL, instance name and API key.',
      };
    }
    next.evolutionBaseUrl = next.evolutionBaseUrl || env.baseUrl;
    next.evolutionInstance = next.evolutionInstance || env.instance;
    next.evolutionApiKey = next.evolutionApiKey || env.apiKey;
  }
  await store.set(WHATSAPP_SETTINGS_KEY, next);
  if (isOnlyBotMenuUpdate) {
    return { ok: true, saved: true };
  }
  if (provider !== 'evolution' || body.connect !== true) {
    return { ok: true, saved: true };
  }
  const config: EvolutionConfig = {
    baseUrl: next.evolutionBaseUrl ?? '',
    instance: next.evolutionInstance ?? '',
    apiKey: next.evolutionApiKey ?? '',
  };
  const webhookUrl = clean(body.webhookUrl);
  const connection = await evolutionConnectionState(config).catch((error: unknown) => ({
    ok: false,
    state: 'error',
    detail: error instanceof Error ? error.message : 'Could not reach Evolution API.',
  }));
  if (!webhookUrl) {
    return { ok: true, saved: true, connection };
  }
  if (!isWebhookUrl(webhookUrl)) {
    return {
      ok: false,
      saved: true,
      connection,
      error: 'Webhook URL must be the Protecta WhatsApp webhook on this server.',
    };
  }
  const webhook = await setEvolutionWebhook(config, webhookUrl).catch((error: unknown) => ({
    ok: false,
    detail: error instanceof Error ? error.message : 'Could not register the webhook.',
  }));
  return { ok: webhook.ok, saved: true, connection, webhook };
};
