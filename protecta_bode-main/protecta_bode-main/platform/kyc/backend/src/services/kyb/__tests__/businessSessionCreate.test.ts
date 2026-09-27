/**
 * createBusinessSession - developer guard.
 *
 * business_sessions.developer_id references developers(id). A stale or
 * fabricated id used to bubble up as a raw Postgres FK violation
 * (insert or update on table "business_sessions" violates foreign key
 * constraint "business_sessions_developer_id_fkey"), which told the caller
 * nothing about what to fix. These tests pin the guard: a missing developer
 * is rejected before the insert with an actionable message, and a 23503
 * raised by the insert itself (developer deleted mid-request) maps onto the
 * same error.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

// The supabase stub switches on the table name, so each test controls the
// developers lookup and the business_sessions insert independently.
type Result = { data: any; error: any };

let results: Record<string, Result>;
let insertedIntoSessions: any[] | null;

function builder(table: string) {
  const b: any = {};
  b.select = vi.fn(() => b);
  b.insert = vi.fn((row: any) => {
    if (table === 'business_sessions') insertedIntoSessions = row;
    return b;
  });
  b.update = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.maybeSingle = vi.fn(async () => results[table] ?? { data: null, error: null });
  b.single = vi.fn(async () => results[table] ?? { data: null, error: null });
  return b;
}

vi.mock('@/config/database.js', () => ({
  supabase: { from: vi.fn((table: string) => builder(table)) },
  connectDB: vi.fn(),
}));

vi.mock('@/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logError: vi.fn(),
  logVerificationEvent: vi.fn(),
}));

// The service pulls these in for OTHER operations (KYC spawn, AML, messaging).
// None of them run during session creation, but the packages they import are
// not installed in the sparse test worktree - so stub the module boundaries,
// mirroring the route tests' approach.
vi.mock('@/middleware/auth.js', () => ({
  hashHandoffToken: (t: string) => t,
}));
vi.mock('@/providers/aml/index.js', () => ({ createAMLProviders: () => [] }));
vi.mock('@/providers/aml/multiScreen.js', () => ({ screenAll: vi.fn(async () => []) }));
vi.mock('@/services/verification.js', () => ({ VerificationService: vi.fn() }));
vi.mock('@/services/sessionPersistence.js', () => ({ saveSessionState: vi.fn() }));
vi.mock('@/services/emailService.js', () => ({ emailService: {} }));
vi.mock('@/services/smsService.js', () => ({
  decryptSMSConfig: vi.fn(),
  sendSmsDirect: vi.fn(),
}));
vi.mock('@/services/whatsappService.js', () => ({
  getWhatsAppConfig: vi.fn(),
  sendWhatsAppLink: vi.fn(),
  sendWhatsAppDocument: vi.fn(),
}));
vi.mock('../businessWebhookDispatch.js', () => ({
  fireBusinessStatusChanged: vi.fn(),
  fireBusinessDataUpdated: vi.fn(),
}));
// Workspace package, not installed in the sparse test worktree. Only the
// VerificationStatus const is used at runtime by the service under test.
vi.mock('@kabila/shared', () => ({
  VerificationStatus: {
    AWAITING_FRONT: 'AWAITING_FRONT',
    FRONT_PROCESSING: 'FRONT_PROCESSING',
    AWAITING_BACK: 'AWAITING_BACK',
    BACK_PROCESSING: 'BACK_PROCESSING',
    CROSS_VALIDATING: 'CROSS_VALIDATING',
    AWAITING_LIVE: 'AWAITING_LIVE',
    LIVE_PROCESSING: 'LIVE_PROCESSING',
    FACE_MATCHING: 'FACE_MATCHING',
    AWAITING_VOICE: 'AWAITING_VOICE',
    VOICE_MATCHING: 'VOICE_MATCHING',
    COMPLETE: 'COMPLETE',
    HARD_REJECTED: 'HARD_REJECTED',
  },
}));

const { createBusinessSession } = await import('../businessSessionService.js');

beforeEach(() => {
  vi.clearAllMocks();
  insertedIntoSessions = null;
  results = {
    developers: { data: { id: 'dev-1' }, error: null },
    business_sessions: {
      data: { id: 'bs-1', developer_id: 'dev-1', status: 'NOT_STARTED' },
      error: null,
    },
  };
});

const INPUT = { developerId: 'dev-1', vendorData: 'acme-ref-1' };

describe('createBusinessSession', () => {
  it('creates a session when the developer account exists', async () => {
    const { session, accessToken } = await createBusinessSession(INPUT);

    expect(session).toMatchObject({ id: 'bs-1', status: 'NOT_STARTED' });
    expect(accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes as base64url
    expect(insertedIntoSessions).toMatchObject({
      developer_id: 'dev-1',
      vendor_data: 'acme-ref-1',
      status: 'NOT_STARTED',
      depth: 0,
    });
  });

  it('rejects an unknown developer before inserting, with an actionable error', async () => {
    results.developers = { data: null, error: null };

    await expect(createBusinessSession(INPUT)).rejects.toMatchObject({
      message: expect.stringContaining('developer account dev-1 does not exist'),
      status: 409,
      code: 'DEVELOPER_NOT_FOUND',
    });

    // The failing insert must not be attempted - nothing should hit the
    // business_sessions table at all.
    expect(insertedIntoSessions).toBeNull();
  });

  it('surfaces the developers lookup failing, not an FK riddle', async () => {
    results.developers = { data: null, error: { message: 'connection reset' } };

    await expect(createBusinessSession(INPUT)).rejects.toThrow(
      'Failed to verify developer account: connection reset',
    );
    expect(insertedIntoSessions).toBeNull();
  });

  it('maps a 23503 FK violation from the insert onto the same actionable error', async () => {
    // The developer was deleted between the existence check and the insert.
    results.business_sessions = {
      data: null,
      error: {
        message:
          'insert or update on table "business_sessions" violates foreign key ' +
          'constraint "business_sessions_developer_id_fkey"',
        code: '23503',
      },
    };

    await expect(createBusinessSession(INPUT)).rejects.toMatchObject({
      message: expect.stringContaining('developer account dev-1 does not exist'),
      status: 409,
      code: 'DEVELOPER_NOT_FOUND',
    });
  });

  it('keeps non-FK insert failures verbatim', async () => {
    results.business_sessions = { data: null, error: { message: 'disk full', code: '53100' } };

    await expect(createBusinessSession(INPUT)).rejects.toThrow(
      'Failed to create business session: disk full',
    );
  });
});
