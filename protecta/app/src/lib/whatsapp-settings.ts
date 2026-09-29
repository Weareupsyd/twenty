import { type StateStore } from 'src/lib/service-otp';
import {
  evolutionConfigFromEnv,
  type EvolutionConfig,
} from 'src/lib/evolution-api';
import { whatsappConfigFromEnv, type WhatsAppConfig } from 'src/lib/whatsapp-api';

export const WHATSAPP_SETTINGS_KEY = 'whatsapp:settings';

export type WhatsAppProvider = 'evolution' | 'meta';

export type BotMenuItem = {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
};

export const DEFAULT_BOT_MENU: BotMenuItem[] = [
  { id: '1', label: 'Calculate premium', description: 'Send the car value, get the premium', enabled: true },
  { id: '2', label: 'Get cover (onboard)', description: 'Make, model, year, plate and name', enabled: true },
  { id: '3', label: 'My policies', description: 'List policies by phone', enabled: true },
  { id: '4', label: 'Pay for a quote', description: 'Pay with mobile money', enabled: true },
  { id: '5', label: 'Report a claim', description: 'Needs policy number', enabled: true },
  { id: '6', label: 'Talk to support', description: 'Create support ticket', enabled: true },
];

export type StoredWhatsAppSettings = {
  provider: WhatsAppProvider;
  evolutionBaseUrl?: string;
  evolutionInstance?: string;
  evolutionApiKey?: string;
  metaToken?: string;
  metaPhoneId?: string;
  metaAppSecret?: string;
  metaVerifyToken?: string;
  botMenu?: BotMenuItem[];
  botWelcomeMessage?: string;
};

export const loadStoredWhatsAppSettings = async (
  store: Pick<StateStore, 'get'>,
): Promise<StoredWhatsAppSettings | null> => {
  try {
    return await store.get<StoredWhatsAppSettings>(WHATSAPP_SETTINGS_KEY);
  } catch {
    return null;
  }
};

export const resolveEvolutionConfig = async (
  store?: Pick<StateStore, 'get'>,
): Promise<EvolutionConfig | null> => {
  const saved = store ? await loadStoredWhatsAppSettings(store) : null;
  if (saved?.provider === 'meta') {
    return null;
  }
  const fromSaved =
    saved?.evolutionBaseUrl && saved.evolutionInstance && saved.evolutionApiKey
      ? {
          baseUrl: saved.evolutionBaseUrl,
          instance: saved.evolutionInstance,
          apiKey: saved.evolutionApiKey,
        }
      : null;
  return fromSaved ?? evolutionConfigFromEnv();
};

export const resolveMetaConfig = async (
  store?: Pick<StateStore, 'get'>,
): Promise<WhatsAppConfig | null> => {
  const saved = store ? await loadStoredWhatsAppSettings(store) : null;
  if (saved?.provider === 'evolution') {
    const evolution = await resolveEvolutionConfig(store);
    if (evolution) {
      return null;
    }
  }
  if (saved?.metaToken && saved.metaPhoneId) {
    return { token: saved.metaToken, phoneId: saved.metaPhoneId };
  }
  return whatsappConfigFromEnv();
};

export const maskSecret = (secret: string | undefined): string => {
  if (!secret) {
    return '';
  }
  return secret.length <= 4 ? '••••' : `••••${secret.slice(-4)}`;
};
