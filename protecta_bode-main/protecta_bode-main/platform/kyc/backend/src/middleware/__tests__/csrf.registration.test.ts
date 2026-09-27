import { describe, expect, it, vi } from 'vitest';
import { conditionalCsrf } from '../csrf.js';

function expectExempt(originalUrl: string) {
  const next = vi.fn();
  conditionalCsrf(
    { originalUrl, cookies: { kabila_token: 'stale-or-other-valid-session' } } as any,
    {} as any,
    next,
  );
  expect(next).toHaveBeenCalledOnce();
}

describe('pre-auth registration CSRF handling', () => {
  it('does not let an existing staff/developer cookie block email OTP completion', () => {
    expectExempt('/api/auth/developer/otp/complete-registration');
  });

  it('does not let an existing cookie block WhatsApp registration completion', () => {
    expectExempt('/api/auth/whatsapp/complete-registration');
  });
});
