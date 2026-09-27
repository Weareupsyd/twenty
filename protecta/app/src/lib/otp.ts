import { randomInt } from 'node:crypto';
import { sha256Hex } from 'src/lib/crypto';

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;

export const generateOtp = (
  rng: () => number = () => randomInt(0, 10) / 10,
): string => {
  let out = '';
  for (let i = 0; i < OTP_LENGTH; i += 1) {
    out += String(Math.floor(rng() * 10));
  }
  return out;
};

export type OtpChallenge = {
  hash: string;
  attempts: number;
  expiresAt: number;
  purpose: string;
};

export const createOtpChallenge = (
  otp: string,
  purpose: string,
  nowMs: number = Date.now(),
): OtpChallenge => ({
  hash: sha256Hex(`${purpose}:${otp}`),
  attempts: 0,
  expiresAt: nowMs + OTP_TTL_SECONDS * 1000,
  purpose,
});

export const verifyOtpChallenge = (
  challenge: OtpChallenge,
  otp: string,
  purpose: string,
  nowMs: number = Date.now(),
): { ok: boolean; attemptsLeft: number; reason?: string } => {
  if (challenge.purpose !== purpose) {
    return { ok: false, attemptsLeft: 0, reason: 'purpose_mismatch' };
  }
  if (nowMs >= challenge.expiresAt) {
    return { ok: false, attemptsLeft: 0, reason: 'expired' };
  }
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, attemptsLeft: 0, reason: 'locked' };
  }
  const ok = sha256Hex(`${purpose}:${otp}`) === challenge.hash;
  return {
    ok,
    attemptsLeft: ok
      ? OTP_MAX_ATTEMPTS - challenge.attempts
      : OTP_MAX_ATTEMPTS - challenge.attempts - 1,
    ...(ok ? {} : { reason: 'mismatch' }),
  };
};
