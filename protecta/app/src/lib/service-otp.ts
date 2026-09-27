import { randomInt, randomUUID } from 'node:crypto';
import { kv } from 'twenty-sdk/logic-function';
import {
  hmacSha256Hex,
  sha256Hex,
  signaturesEqual,
  signJwtHs256,
} from 'src/lib/crypto';
import { OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS } from 'src/lib/otp';
import { normalizeUgPhone } from 'src/lib/phones';
import { sendWhatsAppText, whatsappConfigFromEnv } from 'src/lib/whatsapp-api';
import { otpMessage } from 'src/lib/whatsapp-text';

export type StateStore = Pick<typeof kv, 'get' | 'set' | 'delete'>;
type Challenge = {
  id: string;
  hash: string;
  issuedAt: number;
  expiresAt: number;
};
export const SESSION_TTL_SECONDS = 60 * 60;
export const OTP_RESEND_SECONDS = 60;
const phoneKey = (phone: string) => `otp:phone:${sha256Hex(phone)}`;
const slot = (id: string, index: number | 'success') => `otp:${id}:${index}`;

const secretFromEnv = () => {
  const secret = process.env.SESSION_JWT_SECRET ?? '';
  if (secret.length < 32)
    throw new Error('SESSION_JWT_SECRET must contain at least 32 characters.');
  return secret;
};
const requirePhone = (raw: string) => {
  const phone = normalizeUgPhone(raw);
  if (!phone) throw new Error('A valid phone is required.');
  return phone;
};
const cleanup = async (store: StateStore, id: string) => {
  await Promise.all([
    store.delete(slot(id, 'success')),
    ...Array.from({ length: OTP_MAX_ATTEMPTS }, (_, i) =>
      store.delete(slot(id, i)),
    ),
  ]);
};

/** Persistent state, cryptographic codes and bounded, single-use verification.
 * Atomic KV delete claims attempt slots, so parallel verifications cannot reset
 * the counter or mint more than one session. Issuance cooldown is best-effort:
 * the public endpoint also needs edge rate limiting (KV has no compare-and-set).
 */
export const issueOtp = async (
  rawPhone: string,
  options: {
    store?: StateStore;
    now?: number;
    secret?: string;
    send?: (phone: string, text: string) => Promise<unknown>;
  } = {},
): Promise<{ expiresInMinutes: number }> => {
  const phone = requirePhone(rawPhone);
  const secret = options.secret ?? secretFromEnv();
  const store = options.store ?? kv;
  const now = options.now ?? Date.now();
  const config = whatsappConfigFromEnv();
  const send =
    options.send ??
    (config
      ? (to: string, text: string) => sendWhatsAppText(config, to, text)
      : null);
  if (!send) throw new Error('WhatsApp OTP delivery is not configured.');
  const old = await store.get<Challenge>(phoneKey(phone));
  if (old && now - old.issuedAt < OTP_RESEND_SECONDS * 1000) {
    throw new Error('Please wait 60 seconds before requesting another code.');
  }
  if (old) await cleanup(store, old.id);
  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const challenge: Challenge = {
    id,
    hash: hmacSha256Hex(secret, `${phone}:${id}:${code}`),
    issuedAt: now,
    expiresAt: now + OTP_TTL_SECONDS * 1000,
  };
  await Promise.all([
    store.set(slot(id, 'success'), true),
    ...Array.from({ length: OTP_MAX_ATTEMPTS }, (_, i) =>
      store.set(slot(id, i), true),
    ),
  ]);
  await store.set(phoneKey(phone), challenge);
  try {
    // Unlike best-effort notifications, an OTP must not report success if delivery fails.
    await send(phone, otpMessage(code, 'login'));
  } catch {
    await cleanup(store, id);
    throw new Error('Unable to deliver your code. Please try again later.');
  }
  return { expiresInMinutes: OTP_TTL_SECONDS / 60 };
};

export const verifyOtp = async (
  rawPhone: string,
  code: string,
  options: { store?: StateStore; now?: number; secret?: string } = {},
): Promise<{ token: string } | null> => {
  const phone = requirePhone(rawPhone);
  if (!/^\d{6}$/.test(code)) return null;
  const store = options.store ?? kv;
  const secret = options.secret ?? secretFromEnv();
  const now = options.now ?? Date.now();
  const challenge = await store.get<Challenge>(phoneKey(phone));
  if (!challenge || now >= challenge.expiresAt) return null;
  let claimed = false;
  for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
    if (await store.delete(slot(challenge.id, i))) {
      claimed = true;
      break;
    }
  }
  if (!claimed) return null;
  if (
    !signaturesEqual(
      challenge.hash,
      hmacSha256Hex(secret, `${phone}:${challenge.id}:${code}`),
    )
  )
    return null;
  if (!(await store.delete(slot(challenge.id, 'success')))) return null;
  return {
    token: signJwtHs256(
      { sub: phone, purpose: 'customer-session' },
      secret,
      SESSION_TTL_SECONDS,
      Math.floor(now / 1000),
    ),
  };
};
