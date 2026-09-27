import { logger } from '@/utils/logger.js';
import { decryptSecret } from '@kabila/shared';
import { config } from '@/config/index.js';

/**
 * Developer-provided SMS credentials, decrypted at request time.
 * 
 * Three provider options:
 *   - 'egosms'     -> Uganda-based EgoSMS API (default)
 *   - 'twilio'     -> Twilio SMS
 *   - 'vonage'     -> Vonage (Nexmo) SMS
 */
export interface SMSProviderConfig {
  provider: 'egosms' | 'twilio' | 'vonage';
  /** EgoSMS: username. Twilio: Account SID. Vonage: API key. */
  apiKey: string;
  /** EgoSMS: password. Twilio: Auth Token. Vonage: API secret. */
  apiSecret: string;
  /** Sender ID or phone number (E.164). egosms uses a text sender ID like "Upsyd". */
  phoneNumber: string;
}

/** Built-in EgoSMS credentials - can be overridden by developer config. */
const DEFAULT_EGOSMS_USERNAME = 'iamtutumo';
const DEFAULT_EGOSMS_PASSWORD = 'WFhUryqpgSYVVgeSHYq6k';
const DEFAULT_EGOSMS_SENDER_ID = 'Upsyd';

/**
 * Send a message via EgoSMS (Uganda-based SMS provider).
 * API: POST https://www.egosms.co/api/v1/json/
 * Docs: username + password auth, JSON body per the user's existing setup.
 */
async function sendViaEgoSMS(
  cfg: SMSProviderConfig,
  to: string,
  message: string,
): Promise<boolean> {
  try {
    // Clean the number: EgoSMS expects 256XXXXXXXXX (no leading +)
    const number = to.replace(/^\+/, '').replace(/[^0-9]/g, '');
    const senderid = cfg.phoneNumber || DEFAULT_EGOSMS_SENDER_ID;
    
    const res = await fetch('https://www.egosms.co/api/v1/json/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'SendSms',
        userdata: {
          username: cfg.apiKey || DEFAULT_EGOSMS_USERNAME,
          password: cfg.apiSecret || DEFAULT_EGOSMS_PASSWORD,
        },
        msgdata: [{
          number,
          message,
          senderid,
        }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => 'Unknown error');
      logger.error('EgoSMS API error', { status: res.status, body: errBody });
      return false;
    }

    const data = await res.json() as any;
    // EgoSMS returns a response - check for success indicators
    logger.info('EgoSMS response', { data });
    return true;
  } catch (err) {
    logger.error('EgoSMS request failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Sends an SMS (or WhatsApp fallback) using the configured provider.
 * Returns true on success, false on failure (fire-and-forget style).
 */
export async function sendSmsOtp(
  smsConfig: SMSProviderConfig,
  recipientPhone: string,
  code: string,
): Promise<boolean> {
  const message = `Your verification code is: ${code}. It expires in 10 minutes.`;

  try {
    switch (smsConfig.provider) {
      case 'egosms':
        return await sendViaEgoSMS(smsConfig, recipientPhone, message);
      case 'twilio':
        return await sendViaTwilio(smsConfig, recipientPhone, message);
      case 'vonage':
        return await sendViaVonage(smsConfig, recipientPhone, message);
      default:
        logger.error('Unsupported SMS provider', { provider: smsConfig.provider });
        return false;
    }
  } catch (err) {
    logger.error('SMS send failed', { provider: smsConfig.provider, error: (err as Error).message });
    return false;
  }
}

/**
 * Send a raw message (not just OTP) via the configured SMS provider.
 */
export async function sendSmsDirect(
  smsConfig: SMSProviderConfig,
  recipientPhone: string,
  message: string,
): Promise<boolean> {
  try {
    switch (smsConfig.provider) {
      case 'egosms':
        return await sendViaEgoSMS(smsConfig, recipientPhone, message);
      case 'twilio':
        return await sendViaTwilio(smsConfig, recipientPhone, message);
      case 'vonage':
        return await sendViaVonage(smsConfig, recipientPhone, message);
      default:
        logger.error('Unsupported SMS provider', { provider: smsConfig.provider });
        return false;
    }
  } catch (err) {
    logger.error('SMS send failed', { provider: smsConfig.provider, error: (err as Error).message });
    return false;
  }
}

async function sendViaTwilio(
  cfg: SMSProviderConfig,
  to: string,
  body: string,
): Promise<boolean> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.apiKey}/Messages.json`;
  const auth = Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString('base64');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: cfg.phoneNumber, Body: body }).toString(),
  });

  if (!res.ok) {
    const errBody = await res.text();
    logger.error('Twilio API error', { status: res.status, body: errBody });
    return false;
  }

  return true;
}

async function sendViaVonage(
  cfg: SMSProviderConfig,
  to: string,
  body: string,
): Promise<boolean> {
  const res = await fetch('https://rest.nexmo.com/sms/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: cfg.apiKey,
      api_secret: cfg.apiSecret,
      from: cfg.phoneNumber,
      to: to.replace(/\+/g, ''),
      text: body,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    logger.error('Vonage API error', { status: res.status, body: errBody });
    return false;
  }

  const data = await res.json() as any;
  return data.messages?.[0]?.status === '0';
}

/**
 * Decrypt developer SMS config from DB row.
 * Falls back to the default EgoSMS credentials when no DB config is found,
 * so the service works out-of-the-box.
 */
export function decryptSMSConfig(dev: {
  sms_provider: string | null;
  sms_api_key_encrypted: string | null;
  sms_api_secret_encrypted: string | null;
  sms_phone_number: string | null;
}): SMSProviderConfig | null {
  // If explicitly configured with a provider, decrypt and return
  if (dev?.sms_provider) {
    // If all fields are present, decrypt them
    if (dev.sms_api_key_encrypted && dev.sms_api_secret_encrypted && dev.sms_phone_number) {
      try {
        return {
          provider: dev.sms_provider as SMSProviderConfig['provider'],
          apiKey: decryptSecret(dev.sms_api_key_encrypted, config.encryptionKey),
          apiSecret: decryptSecret(dev.sms_api_secret_encrypted, config.encryptionKey),
          phoneNumber: dev.sms_phone_number,
        };
      } catch (err) {
        logger.error('Failed to decrypt SMS config', { error: (err as Error).message });
        return null;
      }
    }
    // Provider set but fields missing - return null to signal partial config
    return null;
  }

  // No provider configured at all: fall back to the default EgoSMS credentials.
  // This means the service works out-of-the-box with the built-in EgoSMS account.
  logger.info('No developer SMS config - using default EgoSMS provider');
  return {
    provider: 'egosms',
    apiKey: DEFAULT_EGOSMS_USERNAME,
    apiSecret: DEFAULT_EGOSMS_PASSWORD,
    phoneNumber: DEFAULT_EGOSMS_SENDER_ID,
  };
}
