import { describe, expect, it } from 'vitest';
import { createOtpChallenge, generateOtp, verifyOtpChallenge } from 'src/lib/otp';

describe('otp', () => {
  it('generates 6-digit codes', () => {
    expect(generateOtp(() => 0.42)).toMatch(/^\d{6}$/);
  });

  it('verifies matching codes', () => {
    const challenge = createOtpChallenge('123456', 'login', 1_000_000);
    expect(verifyOtpChallenge(challenge, '123456', 'login', 1_000_100).ok).toBe(true);
  });

  it('rejects mismatches, expiry and lockout', () => {
    const challenge = createOtpChallenge('123456', 'login', 1_000_000);
    expect(verifyOtpChallenge(challenge, '000000', 'login', 1_000_100).ok).toBe(false);
    expect(
      verifyOtpChallenge(challenge, '123456', 'login', 1_000_000 + 11 * 60 * 1000).reason,
    ).toBe('expired');
    const locked = { ...challenge, attempts: 5 };
    expect(verifyOtpChallenge(locked, '123456', 'login', 1_000_100).reason).toBe('locked');
    expect(verifyOtpChallenge(challenge, '123456', 'other', 1_000_100).reason).toBe(
      'purpose_mismatch',
    );
  });
});
