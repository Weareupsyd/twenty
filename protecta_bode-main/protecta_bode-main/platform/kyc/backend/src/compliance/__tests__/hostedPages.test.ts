import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cquery: vi.fn(),
  hashHandoffToken: vi.fn(() => 'a'.repeat(64)),
  supabaseFrom: vi.fn(),
  createVerificationRequest: vi.fn(),
  saveSessionState: vi.fn(),
}));

vi.mock('../query.js', () => ({
  cquery: mocks.cquery,
  asRecord: (value: unknown) => value && typeof value === 'object' ? value as Record<string, unknown> : {},
}));

vi.mock('@/middleware/auth.js', () => ({ hashHandoffToken: mocks.hashHandoffToken }));

vi.mock('@/config/database.js', () => ({
  supabase: { from: mocks.supabaseFrom },
}));

vi.mock('@/services/verification.js', () => ({
  VerificationService: class {
    async createVerificationRequest(data: Record<string, unknown>) {
      return mocks.createVerificationRequest(data);
    }
  },
}));

vi.mock('@/services/sessionPersistence.js', () => ({ saveSessionState: mocks.saveSessionState }));

import {
  createHostedSession,
  normalizeHostedPageConfig,
  validateHostedSlug,
} from '../hostedPages.js';

function chain(result: Record<string, unknown>) {
  const c: Record<string, () => typeof c> & { then: (fn: (v: unknown) => unknown) => Promise<unknown> } = {
    select: () => c,
    eq: () => c,
    maybeSingle: () => c,
    insert: () => c,
    update: () => c,
    delete: () => c,
    then: (fn) => Promise.resolve(result).then(fn),
  };
  return c;
}

describe('hosted-page configuration', () => {
  beforeEach(() => {
    mocks.cquery.mockReset();
    mocks.hashHandoffToken.mockClear();
    mocks.supabaseFrom.mockReset();
    mocks.createVerificationRequest.mockReset();
    mocks.saveSessionState.mockReset();
    mocks.saveSessionState.mockResolvedValue(undefined);
  });

  it('normalizes an age-verification template and its page steps', () => {
    const config = normalizeHostedPageConfig({
      verificationMode: 'age_only',
      ageThreshold: 21,
      accentColor: '#123ABC',
      steps: { back: { enabled: false, label: 'Not required' } },
    });

    expect(config.verificationMode).toBe('age_only');
    expect(config.ageThreshold).toBe(21);
    expect(config.accentColor).toBe('#123ABC');
    expect(config.steps.front).toEqual({ enabled: true, label: 'Front of ID' });
    expect(config.steps.back).toEqual({ enabled: false, label: 'Not required' });
  });

  it('rejects unsafe or malformed custom slugs', () => {
    expect(validateHostedSlug('retail-onboarding')).toBe('retail-onboarding');
    expect(() => validateHostedSlug('../admin')).toThrow(/Slug must be/);
  });

  it('creates a tokenized age-verification URL without exposing an API key', async () => {
    mocks.cquery
      .mockResolvedValueOnce({ rows: [{
        developer_id: '11111111-1111-4111-8111-111111111111',
        slug: 'retail-onboarding',
        page_builder_config: { verificationMode: 'full', ageThreshold: 18 },
        api_key_id: '22222222-2222-4222-8222-222222222222',
        is_sandbox: false,
      }] })
      .mockResolvedValue({ rows: [] });
    mocks.createVerificationRequest.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
    });
    // users.select + users.insert + verification_requests.update all resolve
    // to { data: null, error: null } via the generic chain.
    mocks.supabaseFrom.mockReturnValue(chain({ data: null, error: null }));

    const result = await createHostedSession({
      developerId: '11111111-1111-4111-8111-111111111111',
      verificationMode: 'age_only',
      ageThreshold: 21,
      issuingCountry: 'ug',
      publicOrigin: 'https://verify.example.test/',
      applicant: { firstName: 'Amina' },
    });

    expect(result).toMatchObject({
      verification_mode: 'age_only',
      age_threshold: 21,
      sandbox: false,
    });
    expect(String(result.verification_url)).toMatch(/^https:\/\/verify\.example\.test\/v\/retail-onboarding\?session=[0-9a-f]{64}$/);
    expect(String(result.session_token)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(result.verification_url)).toContain(String(result.session_token));
    expect(String(result.verification_url)).not.toContain('api_key');
    expect(mocks.hashHandoffToken).toHaveBeenCalledOnce();

    // Session is created on the same path as /api/v2/verify/initialize -
    // source='api' (never 'demo') and a persistent session context.
    expect(mocks.createVerificationRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        developer_id: '11111111-1111-4111-8111-111111111111',
        is_sandbox: false,
        source: 'api',
      }),
    );
    expect(mocks.saveSessionState).toHaveBeenCalledOnce();
  });
});
