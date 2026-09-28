import { type StateStore } from 'src/lib/service-otp';
import {
  evolutionConfigFromEnv,
  type EvolutionConfig,
} from 'src/lib/evolution-api';
import { whatsappConfigFromEnv, type WhatsAppConfig } from 'src/lib/whatsapp-api';

export const WHATSAPP_SETTINGS_KEY = 'whatsapp:settings';

export type WhatsAppProvider = 'evolution' | 'meta';

export type StoredWhatsAppSettings = {
  provider: WhatsAppProvider;
  evolutionBaseUrl?: string;
  evolutionInstance?: string;
  evolutionApiKey?: string;
  metaToken?: string;
  metaPhoneId?: string;
  metaAppSecret?: string;
  metaVerifyToken?: string;
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
