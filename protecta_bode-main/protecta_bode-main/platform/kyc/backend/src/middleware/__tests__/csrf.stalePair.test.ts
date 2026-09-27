/**
 * Regression tests for the developer-portal 500 storm (Aug 2026).
 *
 * Incident signature from the browser console:
 *   GET  /api/auth/csrf-token                 -> 500 (every retry)
 *   POST /api/auth/developer/resolve-session  -> 500
 *   POST /api/developer/webhooks              -> 500
 *
 * Root cause chain:
 *   1. The browser held a CSRF cookie whose token|hash pair no longer
 *      validated (cookie predates a JWT_SECRET rotation). csrf-csrf v3's
 *      generateToken() defaults to validateOnReuse=true, which THROWS on an
 *      unvalidatable stored pair - and because it throws before setting the
 *      replacement cookie, the stale cookie was never repaired and every
 *      retry failed identically.
 *   2. With no token in hand the frontend sent mutations without
 *      X-CSRF-Token; conditionalCsrf handed csrf-csrf's ForbiddenError to the
 *      global error handler, which (no isOperational flag) masked the by-design
 *      403 as a generic 500 "Something went wrong!".
 *
 * Both are fixed: csrf-token now mint-or-reuse (never throw), and CSRF
 * rejections surface as 403 {code: CSRF_INVALID} so the frontend's documented
 * recovery path (refetch the token) works.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';

const JWT_SECRET = 'test-jwt-secret';

vi.mock('@/config/index.js', () => ({
  default: { jwtSecret: JWT_SECRET, nodeEnv: 'test', apiKeySecret: 'test-api-secret' },
}));

vi.mock('@/config/database.js', () => ({
  supabase: {
    from: (_table: string) => ({
      select: () => {
        const chain: any = {
          eq: () => chain,
          single: async () => ({ data: null, error: { code: 'PGRST116' } }),
          limit: async () => ({ data: [], error: null }),
        };
        return chain;
      },
      insert: () => ({
        select: () => ({
          single: async () => ({ data: null, error: { code: 'PGRST116' } }),
        }),
      }),
    }),
  },
  connectDB: vi.fn(),
}));

vi.mock('@/compliance/staffAuth.js', () => ({
  resolveStaff: vi.fn(async () => null),
  requireStaff: vi.fn(),
}));

vi.mock('@/services/staffService.js', () => ({
  findStaffByEmail: vi.fn(async () => null),
  findStaffById: vi.fn(async () => null),
  findStaffByWhatsapp: vi.fn(async () => null),
  touchStaffSession: vi.fn(async () => {}),
  upsertStaffFromLogin: vi.fn(),
  verifyStaffPassword: vi.fn(async () => false),
}));

vi.mock('@/services/otpService.js', () => ({
  createAndSendOtp: vi.fn(async () => ({ success: true })),
  verifyOtp: vi.fn(async () => { throw new Error('not under test'); }),
}));

vi.mock('@/services/githubOAuthService.js', () => ({
  getGithubOAuthConfig: vi.fn(async () => ({ configured: false })),
  exchangeCodeForTokens: vi.fn(),
  upsertGithubDeveloper: vi.fn(),
}));

vi.mock('@/services/storage.js', () => ({
  resolvePublicAssetUrl: vi.fn(async (p: string) => p),
}));

vi.mock('@/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logError: vi.fn(),
}));

let app: Express;

beforeEach(async () => {
  const authRouter = (await import('../../routes/auth.js')).default;
  const { conditionalCsrf } = await import('@/middleware/csrf.js');
  const { errorHandler } = await import('@/middleware/errorHandler.js');

  app = express();
  app.use(cookieParser());
  app.use('/api/auth', conditionalCsrf, authRouter);
  app.use(errorHandler);
});

/** A cryptographically valid cookie - enough for conditionalCsrf to arm CSRF. */
function staffCookie(): string {
  return jwt.sign(
    { id: 'staff-1', email: 'admin@example.com', type: 'staff' },
    JWT_SECRET,
    { issuer: 'compliance', audience: 'compliance', expiresIn: '1h' },
  );
}

describe('GET /api/auth/csrf-token with a stale stored CSRF cookie', () => {
  it('mints a fresh token instead of rejecting the stale pair', async () => {
    const stalePair = 'aaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbb'; // invalid token|hash

    const res = await request(app)
      .get('/api/auth/csrf-token')
      .set('Cookie', [`_csrf=${stalePair}`, `kabila_token=${staffCookie()}`]);

    expect(res.status).toBe(200);
    expect(typeof res.body.csrfToken).toBe('string');
    expect(res.body.csrfToken.length).toBeGreaterThan(0);

    // The replacement cookie must be set so the browser recovers.
    const setCookie = (res.headers['set-cookie'] as string[]).join(' ');
    expect(setCookie).toContain('_csrf=');
    expect(setCookie).not.toContain(stalePair);
  });

  it('still works with no cookie at all', async () => {
    const res = await request(app).get('/api/auth/csrf-token');
    expect(res.status).toBe(200);
    expect(typeof res.body.csrfToken).toBe('string');
  });

  it('reuses a still-valid pair (multi-tab stable)', async () => {
    const first = await request(app).get('/api/auth/csrf-token');
    const cookie = (first.headers['set-cookie'] as string[])[0].split(';')[0];

    const second = await request(app)
      .get('/api/auth/csrf-token')
      .set('Cookie', cookie);

    expect(second.status).toBe(200);
    expect(second.body.csrfToken).toBe(first.body.csrfToken);
  });
});

describe('authed mutations with missing/invalid CSRF now 403 CSRF_INVALID (not 500)', () => {
  it('resolve-session without X-CSRF-Token answers 403 CSRF_INVALID', async () => {
    const res = await request(app)
      .post('/api/auth/developer/resolve-session')
      .set('Cookie', `kabila_token=${staffCookie()}`)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
    expect(res.body.message).not.toBe('Something went wrong!');
  });

  it('resolve-session with a fresh token+cookie passes CSRF and reaches the handler', async () => {
    const tokenRes = await request(app).get('/api/auth/csrf-token');
    expect(tokenRes.status).toBe(200);
    const csrfCookie = (tokenRes.headers['set-cookie'] as string[])[0].split(';')[0];

    const res = await request(app)
      .post('/api/auth/developer/resolve-session')
      .set('Cookie', [`kabila_token=${staffCookie()}`, csrfCookie])
      .set('X-CSRF-Token', tokenRes.body.csrfToken)
      .send({});

    // Handler reached: mocked staff lookup finds nobody -> normal 200 probe
    // response. The important assertion is that CSRF did not reject it.
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  it('resolve-session without any auth cookie skips CSRF (pre-auth probe)', async () => {
    const res = await request(app)
      .post('/api/auth/developer/resolve-session')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });
});
