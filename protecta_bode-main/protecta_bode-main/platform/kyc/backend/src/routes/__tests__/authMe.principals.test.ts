/**
 * Tests for GET /api/auth/me multi-principal hydration and the
 * POST /api/auth/developer/resolve-session staff->developer bridge
 * (routes/auth.ts).
 *
 * Incident context (developer-portal webhook 500s): /me only hydrated
 * compliance staff, so a logged-in DEVELOPER got a 401 that the combined
 * console rendered as "not logged in". /me must now answer 200 for every
 * console principal, tagged with `principal`, while the staff `user` shape
 * stays byte-for-byte compatible.
 *
 * The bridge must also stop dead-ending when a staff admin has no developer
 * row: it provisions a VERIFIED developer row for their email instead of
 * returning `hosted_developer_missing` (which left the portal unable to add
 * webhooks without a separate OTP signup).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-jwt-secret';

const state = vi.hoisted(() => ({
  // resolveStaff return value (staff principal for the kabila_token).
  staffPrincipal: null as any,
  // staffService row used by the resolve-session bridge (compliance token).
  staffRow: null as any,
  // developers rows served to developer-token lookups / bridge lookups.
  developerRows: [] as any[],
  // Rows captured by developers.insert (bridge provisioning).
  insertedDevelopers: [] as any[],
  // Error for developers.insert.
  insertDeveloperError: null as any,
}));

vi.mock('@/config/index.js', () => ({
  default: { jwtSecret: JWT_SECRET, nodeEnv: 'test', apiKeySecret: 'test-api-secret' },
}));

// supabase mock: serves the `developers` table with filter application.
vi.mock('@/config/database.js', () => {
  const applyFilters = (rows: any[], filters: Array<[string, any]>) =>
    rows.filter((r) =>
      filters.every(([col, val]) => (val === null ? r[col] == null : r[col] === val)),
    );

  return {
    supabase: {
      from: (table: string) => {
        if (table !== 'developers') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ single: async () => ({ data: null, error: { code: 'PGRST116' } }) }),
              }),
            }),
            update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
          };
        }
        return {
          select: () => {
            const filters: Array<[string, any]> = [];
            const chain: any = {
              eq: (col: string, val: any) => { filters.push([col, val]); return chain; },
              single: () => {
                const matched = applyFilters(state.developerRows, filters);
                return matched.length === 0
                  ? Promise.resolve({ data: null, error: { code: 'PGRST116' } })
                  : Promise.resolve({ data: matched[0], error: null });
              },
            };
            return chain;
          },
          insert: (row: any) => {
            state.insertedDevelopers.push(row);
            if (state.insertDeveloperError) {
              return {
                select: () => ({
                  single: async () => ({ data: null, error: state.insertDeveloperError }),
                }),
              };
            }
            const created = { id: 'provisioned-dev-uuid', status: 'active', ...row };
            return {
              select: () => ({
                single: async () => ({ data: created, error: null }),
              }),
            };
          },
        };
      },
    },
    connectDB: vi.fn(),
  };
});

vi.mock('@/compliance/staffAuth.js', () => ({
  resolveStaff: vi.fn(async () => state.staffPrincipal),
  requireStaff: vi.fn(),
}));

vi.mock('@/services/staffService.js', () => ({
  findStaffByEmail: vi.fn(async (email: string) =>
    state.staffRow?.email === email ? state.staffRow : null),
  findStaffById: vi.fn(async (id: string) =>
    state.staffRow?.id === id ? state.staffRow : null),
  findStaffByWhatsapp: vi.fn(async () => null),
  touchStaffSession: vi.fn(async () => {}),
  upsertStaffFromLogin: vi.fn(),
  verifyStaffPassword: vi.fn(async () => false),
}));

vi.mock('@/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logError: vi.fn(),
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

let app: Express;

beforeEach(async () => {
  state.staffPrincipal = null;
  state.staffRow = null;
  state.developerRows = [];
  state.insertedDevelopers = [];
  state.insertDeveloperError = null;

  const mod = await import('../auth.js');
  const { errorHandler } = await import('@/middleware/errorHandler.js');
  app = express();
  app.use(express.json());
  app.use((_req, _res, next) => next()); // cookie parsing not needed: bearer or signed cookie via supertest
  app.use('/api/auth', mod.default);
  app.use(errorHandler);
});

const developerToken = (payload: object = { id: 'dev-1', email: 'dev@x.io', type: 'developer' }) =>
  jwt.sign(payload, JWT_SECRET, { issuer: 'kabila-api', audience: 'kabila-developer', expiresIn: '1h' });

const staffToken = (payload: object = { id: 'staff-1', email: 's@x.io', type: 'staff' }) =>
  jwt.sign(payload, JWT_SECRET, { issuer: 'compliance', audience: 'compliance', expiresIn: '1h' });

const operatorToken = () =>
  jwt.sign({ type: 'service-operator' }, JWT_SECRET, {
    issuer: 'kabila-api', audience: 'kabila-service-operator', expiresIn: '1h',
  });

describe('GET /api/auth/me - multi-principal hydration', () => {
  it('returns principal "staff" with the historical user shape for a staff token', async () => {
    state.staffPrincipal = {
      id: 'staff-1', email: 's@x.io', full_name: 'Staff One', role: 'admin',
      aml_role: 'superuser', readonly: false, scopes: ['kyc', 'aml'],
    };
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.principal).toBe('staff');
    expect(res.body.user).toEqual({
      id: 'staff-1', email: 's@x.io', full_name: 'Staff One', role: 'admin',
      aml_role: 'superuser', readonly: false, scopes: ['kyc', 'aml'],
    });
  });

  it('returns principal "developer" (200, not 401) for a developer portal JWT', async () => {
    state.developerRows = [
      { id: 'dev-1', email: 'dev@x.io', name: 'Dev', company: 'ACME', status: 'active', is_verified: true },
    ];
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${developerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.principal).toBe('developer');
    expect(res.body.developer).toMatchObject({ id: 'dev-1', email: 'dev@x.io', status: 'active' });
    expect(res.body.user).toBeUndefined();
  });

  it('returns principal "service-operator" for an operator session', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${operatorToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.principal).toBe('service-operator');
  });

  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a developer token whose row is suspended or unverified', async () => {
    state.developerRows = [
      { id: 'dev-1', email: 'dev@x.io', status: 'suspended', is_verified: true },
    ];
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${developerToken()}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/developer/resolve-session - staff bridge', () => {
  const adminStaff = {
    id: 'staff-1', email: 'admin@x.io', full_name: 'Console Admin', is_active: true,
    kyc_role: 'admin', readonly: false, scopes: ['kyc', 'aml'],
  };

  it('bridges onto the developer row matching the staff email when it exists', async () => {
    state.staffRow = adminStaff;
    state.developerRows = [
      { id: 'dev-77', email: 'admin@x.io', status: 'active', is_verified: true },
    ];

    const res = await request(app)
      .post('/api/auth/developer/resolve-session')
      .set('Authorization', `Bearer ${staffToken({ id: 'staff-1', email: 'admin@x.io', type: 'staff' })}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ authenticated: true, principal: 'developer' });
    expect(state.insertedDevelopers).toHaveLength(0);
  });

  it('provisions a VERIFIED developer row when neither a matching row nor the hosted fallback exists', async () => {
    state.staffRow = adminStaff;
    state.developerRows = []; // no staff-email row, no service+hosted-pages fallback

    const res = await request(app)
      .post('/api/auth/developer/resolve-session')
      .set('Authorization', `Bearer ${staffToken({ id: 'staff-1', email: 'admin@x.io', type: 'staff' })}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ authenticated: true, principal: 'developer', bridged: true });
    expect(state.insertedDevelopers).toHaveLength(1);
    expect(state.insertedDevelopers[0]).toMatchObject({
      email: 'admin@x.io',
      is_verified: true,
    });
    // The bridge mints a developer cookie the webhook routes accept.
    expect(res.headers['set-cookie']).toBeDefined();
    const cookie = (res.headers['set-cookie'] as string[]).join('\n');
    expect(cookie).toContain('kabila_token=');
  });

  it('falls back gracefully when provisioning fails (no 500)', async () => {
    state.staffRow = adminStaff;
    state.developerRows = [];
    state.insertDeveloperError = { code: '42501', message: 'row-level security policy' };

    const res = await request(app)
      .post('/api/auth/developer/resolve-session')
      .set('Authorization', `Bearer ${staffToken({ id: 'staff-1', email: 'admin@x.io', type: 'staff' })}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false, reason: 'developer_provisioning_failed' });
  });

  it('reports developer_admin_required for a non-admin staff token', async () => {
    state.staffRow = { ...adminStaff, kyc_role: 'reviewer' };
    const res = await request(app)
      .post('/api/auth/developer/resolve-session')
      .set('Authorization', `Bearer ${staffToken({ id: 'staff-1', email: 'admin@x.io', type: 'staff' })}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false, reason: 'developer_admin_required' });
  });
});
