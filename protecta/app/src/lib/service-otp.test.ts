import { describe, expect, it, vi } from 'vitest';
import { issueOtp, verifyOtp } from 'src/lib/service-otp';
import { verifyJwtHs256 } from 'src/lib/crypto';
import { MemoryState } from 'src/test-utils/memory-state';

const secret = 'test-only-secret-'.repeat(4);
const phone = '+256772000000';
const now = 1_800_000_000_000;
const setup = async () => {
  const store = new MemoryState();
  const send = vi.fn(async () => {});
  const options = { store, secret, now, send };
  await issueOtp(phone, options);
  const code =
    (send.mock.calls[0] as unknown as [string, string])[1].match(
      /\*(\d{6})\*/,
    )?.[1] ?? '';
  return { store, send, options, code };
};
describe('OTP service', () => {
  it('delivers a cryptographic code without persisting plaintext and issues a phone-bound session', async () => {
    const { store, options, code } = await setup();
    expect(code).toMatch(/^\d{6}$/);
    expect(JSON.stringify([...store.values.values()])).not.toContain(
      `"${code}"`,
    );
    const session = await verifyOtp(phone, code, options);
    const claims = verifyJwtHs256(session!.token, secret, now / 1000);
    expect(claims).toMatchObject({
      sub: phone,
      purpose: 'customer-session',
      exp: now / 1000 + 3600,
    });
    expect(await verifyOtp(phone, code, options)).toBeNull();
  });
  it('allows only one session under parallel correct submissions', async () => {
    const { options, code } = await setup();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => verifyOtp(phone, code, options)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it('consumes at most five attempts even with concurrent guesses', async () => {
    const { options, code } = await setup();
    const wrong = code === '000000' ? '111111' : '000000';
    await Promise.all(
      Array.from({ length: 20 }, () => verifyOtp(phone, wrong, options)),
    );
    expect(await verifyOtp(phone, code, options)).toBeNull();
  });
  it('rejects expired, malformed, wrong-phone and wrong-secret attempts', async () => {
    const { options, code } = await setup();
    expect(await verifyOtp(phone, '12345x', options)).toBeNull();
    expect(await verifyOtp('+256773000000', code, options)).toBeNull();
    expect(
      await verifyOtp(phone, code, { ...options, secret: 'different' }),
    ).toBeNull();
    expect(
      await verifyOtp(phone, code, { ...options, now: now + 600_000 }),
    ).toBeNull();
  });
  it('enforces a resend cooldown and invalidates the previous challenge', async () => {
    const { options, code, send } = await setup();
    await expect(issueOtp(phone, options)).rejects.toThrow('wait 60');
    await issueOtp(phone, { ...options, now: now + 60_000 });
    expect(send).toHaveBeenCalledTimes(2);
    const next =
      (send.mock.calls[1] as unknown as [string, string])[1].match(
        /\*(\d{6})\*/,
      )?.[1] ?? '';
    if (next !== code)
      expect(
        await verifyOtp(phone, code, { ...options, now: now + 60_000 }),
      ).toBeNull();
    expect(
      await verifyOtp(phone, next, { ...options, now: now + 60_000 }),
    ).not.toBeNull();
  });
  it('does not report success or allow verification after failed delivery', async () => {
    const store = new MemoryState();
    let code = '';
    await expect(
      issueOtp(phone, {
        store,
        now,
        secret,
        send: async (_to, message) => {
          code = message.match(/\*(\d{6})\*/)?.[1] ?? '';
          throw new Error('provider down');
        },
      }),
    ).rejects.toThrow('Unable to deliver');
    expect(await verifyOtp(phone, code, { store, now, secret })).toBeNull();
  });
});
