/**
 * Test: GET /api/verify/handoff/:token/status - server-side completion fallback
 *
 * Regression coverage for the "results never show" bug:
 * In the hosted-page flow the desktop's session token is bound to the
 * desktop's own verification, so it cannot poll the verification the phone
 * created via the handoff (GET /api/v2/verify/:id/status -> 400 on every
 * poll). If the mobile's PATCH /complete never lands, the handoff row stays
 * 'pending' forever and the desktop never displays a result.
 *
 * The fix resolves the linked verification's terminal state server-side in
 * the handoff status endpoint. These tests cover the extracted pure helpers:
 *  - computeHandoffFinalResult: terminal-state detection
 *  - buildHandoffResult: result payload (same shape mobile PATCHes)
 */
import { describe, it, expect, vi } from 'vitest';

// handoff.ts imports the database/config modules at load time - stub them so
// the pure helpers can be imported without a live environment.
vi.mock('@/config/database.js', () => ({ supabase: { from: vi.fn() } }));
vi.mock('@/config/index.js', () => ({ default: { apiKeySecret: 'test-secret' } }));
vi.mock('@/middleware/auth.js', () => ({ hashHandoffToken: vi.fn(() => 'a'.repeat(64)) }));
vi.mock('@/middleware/rateLimit.js', () => ({ basicRateLimit: (_req: any, _res: any, next: any) => next() }));
vi.mock('@/services/storage.js', () => ({ resolvePublicAssetUrl: vi.fn() }));

import { computeHandoffFinalResult, buildHandoffResult } from '../handoff.js';


const COMPLETE_STATE: any = {
  session_id: 'ver-001',
  current_step: 'COMPLETE',
  front_extraction: { ocr: { full_name: 'John Doe' } },
  back_extraction: { qr_payload: {} },
  cross_validation: { verdict: 'PASS', has_critical_failure: false },
  face_match: { passed: true, similarity_score: 0.87 },
  liveness: { passed: true, liveness_score: 0.93 },
};

const MIDFLOW_STATE: any = {
  session_id: 'ver-001',
  current_step: 'AWAITING_LIVE',
  front_extraction: { ocr: { full_name: 'John Doe' } },
  back_extraction: { qr_payload: {} },
  cross_validation: { verdict: 'PASS', has_critical_failure: false },
  face_match: null,
  liveness: null,
};

describe('computeHandoffFinalResult - terminal detection', () => {
  it('returns the DB status directly when it is terminal', () => {
    expect(computeHandoffFinalResult('verified', null)).toBe('verified');
    expect(computeHandoffFinalResult('failed', null)).toBe('failed');
    expect(computeHandoffFinalResult('manual_review', null)).toBe('manual_review');
  });

  it('returns null when DB status is non-terminal and no session state exists', () => {
    expect(computeHandoffFinalResult('pending', null)).toBeNull();
    expect(computeHandoffFinalResult('processing', null)).toBeNull();
    expect(computeHandoffFinalResult(null, null)).toBeNull();
    expect(computeHandoffFinalResult(undefined, null)).toBeNull();
  });

  it('falls back to session state when DB status is non-terminal - COMPLETE step resolves', () => {
    const result = computeHandoffFinalResult('processing', COMPLETE_STATE, 'full');
    expect(result).toBe('verified');
  });

  it('resolves HARD_REJECTED session state to failed', () => {
    const state = { ...COMPLETE_STATE, current_step: 'HARD_REJECTED' };
    expect(computeHandoffFinalResult('processing', state, 'full')).toBe('failed');
  });

  it('returns null while the verification is mid-flow (stays pending)', () => {
    expect(computeHandoffFinalResult('processing', MIDFLOW_STATE, 'full')).toBeNull();
  });

  it('resolves cross-validation REVIEW verdict to manual_review', () => {
    const state = {
      ...COMPLETE_STATE,
      cross_validation: { verdict: 'REVIEW', has_critical_failure: false },
    };
    expect(computeHandoffFinalResult('processing', state, 'full')).toBe('manual_review');
  });

  it('defaults to the full flow when verification_mode is missing', () => {
    expect(computeHandoffFinalResult('processing', COMPLETE_STATE, null)).toBe('verified');
    expect(computeHandoffFinalResult('processing', COMPLETE_STATE, undefined)).toBe('verified');
  });
});

describe('buildHandoffResult - payload shape', () => {
  it('matches the shape the mobile page PATCHes on /complete', () => {
    const result = buildHandoffResult('ver-001', 'verified', COMPLETE_STATE, 'ext-user-42');
    expect(result).toEqual({
      verification_id: 'ver-001',
      status: 'verified',
      user_id: 'ext-user-42',
      face_match_score: 0.87,
      liveness_score: 0.93,
    });
  });

  it('omits optional fields when unavailable', () => {
    const result = buildHandoffResult('ver-001', 'failed', null, null);
    expect(result).toEqual({ verification_id: 'ver-001', status: 'failed' });
    expect(result).not.toHaveProperty('user_id');
    expect(result).not.toHaveProperty('face_match_score');
    expect(result).not.toHaveProperty('liveness_score');
  });
});

describe('desktop fallback poll gating (ContinueOnPhone)', () => {
  // Mirrors the frontend rule: session tokens are bound to the desktop's own
  // verification - polling a different (mobile-created) verification with them
  // is always rejected with 400, so the direct poll must be skipped.
  function canPollDirectly(
    sessionToken: string | undefined,
    apiKey: string,
    handoffVerificationId: string,
    ownVerificationId?: string,
  ): boolean {
    return sessionToken
      ? handoffVerificationId === ownVerificationId
      : !!apiKey.trim();
  }

  it('skips the direct poll when the session token is bound to a different verification', () => {
    expect(canPollDirectly('tok', '', 'ver-mobile', 'ver-desktop')).toBe(false);
  });

  it('allows the direct poll when the handoff reuses the desktop verification', () => {
    expect(canPollDirectly('tok', '', 'ver-desktop', 'ver-desktop')).toBe(true);
  });

  it('allows the direct poll with an API key (developer-scoped, owns both)', () => {
    expect(canPollDirectly(undefined, 'kbl_live_key', 'ver-mobile', undefined)).toBe(true);
  });

  it('skips the direct poll when neither credential is usable', () => {
    expect(canPollDirectly(undefined, '   ', 'ver-mobile', undefined)).toBe(false);
  });
});
