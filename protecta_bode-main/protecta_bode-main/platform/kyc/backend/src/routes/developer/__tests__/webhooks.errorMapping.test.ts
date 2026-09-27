/**
 * Error-mapping regression tests for POST /api/developer/webhooks
 * (developer/webhooks.ts).
 *
 * Incident: adding a webhook from the developer portal returned
 * HTTP 500 `{ message: "Something went wrong!" }` for every KNOWN failure
 * class - duplicate URL, RLS denial, FK miss, missing column - because the
 * handler threw bare `Error`s (non-operational) at the Supabase layer.
 *
 * Contract under test (handoff table):
 *   | Case                         | HTTP | Message                              |
 *   |------------------------------|------|--------------------------------------|
 *   | no developer session         | 401  | Developer authentication required   |
 *   | URL not https                | 400  | Valid HTTPS webhook URL is required  |
 *   | SSRF / private IP / DNS fail | 400  | validateWebhookUrl text              |
 *   | unknown event names          | 400  | Invalid webhook events: …            |
 *   | duplicate URL                | 400  | Webhook already exists …             |
 *   | insert / unique / FK / RLS   | 400  | Postgres/Supabase message            |
 *
 * Plus the acceptance case from the Ijayo integration: creating a webhook
 * for https://ijayo.weareupsyd.com/ijayo/compliance/webhook with the person
 * verification event set must return 201 with a whsec_… signing secret.
 *
 * The app under test wires the PRODUCTION errorHandler so these assertions
 * reflect what the portal actually receives, not a test-only translator.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const REAL_DEV = 'real-dev-uuid';

const IJAYO_URL = 'https://ijayo.weareupsyd.com/ijayo/compliance/webhook';

const PERSON_EVENTS = [
  'verification.started',
  'verification.document_processed',
  'verification.completed',
  'verification.failed',
  'verification.manual_review',
  'document.expiry_warning',
  'verification.reverification_due',
];

const state = vi.hoisted(() => ({
  // Rows the duplicate-probe select matches (before .limit(1)).
  dupRows: [] as any[],
  // Error returned by the duplicate-probe select.
  dupError: null as any,
  // Error returned by the insert.
  insertError: null as any,
  // Captured insert rows.
  inserted: [] as any[],
}));

// --- supabase mock: filter-applying engine with injectable failures --------
vi.mock('@/config/database.js', () => {
  const applyFilters = (rows: any[], filters: Array<[string, any]>) =>
    rows.filter((r) =>
      filters.every(([col, val]) => (val === null ? r[col] == null : r[col] === val)),
    );

  return {
    supabase: {
      from: (table: string) => {
        if (table !== 'webhooks') {
          // api_keys ownership check path (unused when api_key_id is null)
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: () => Promise.resolve({ data: null, error: { code: 'PGRST116' } }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => {
            const filters: Array<[string, any]> = [];
            const chain: any = {
              eq: (col: string, val: any) => { filters.push([col, val]); return chain; },
              is: (col: string, val: any) => { filters.push([col, val]); return chain; },
              order: () =>
                Promise.resolve({
                  data: state.dupError ? null : applyFilters(state.dupRows, filters),
                  error: state.dupError,
                }),
              limit: (n: number) =>
                Promise.resolve({
                  data: state.dupError ? null : applyFilters(state.dupRows, filters).slice(0, n),
                  error: state.dupError,
                }),
              single: () => {
                const matched = applyFilters(state.dupRows, filters);
                return matched.length === 0
                  ? Promise.resolve({ data: null, error: { code: 'PGRST116' } })
                  : Promise.resolve({ data: matched[0], error: null });
              },
            };
            return chain;
          },
          insert: (row: any) => {
            state.inserted.push(row);
            if (state.insertError) {
              return {
                select: () => ({
                  single: () => Promise.resolve({ data: null, error: state.insertError }),
                }),
              };
            }
            const created = { ...row, id: 'created-webhook-uuid', is_active: true, created_at: '2026-08-24T00:00:00Z' };
            return {
              select: () => ({ single: () => Promise.resolve({ data: created, error: null }) }),
            };
          },
          delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
        };
      },
    },
    connectDB: vi.fn(),
  };
});

// --- auth stub: drive the principal via header; 'none' bypasses without one -
vi.mock('@/middleware/auth.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const setPrincipal = (req: any, res: any, next: any) => {
    const who = req.headers['x-test-principal'];
    if (who === 'jwt') {
      req.developer = { id: REAL_DEV, status: 'active' };
    }
    // 'none' (or absent header): middleware "passes" but sets NO principal,
    // exercising the route-level 401 guard.
    next();
  };
  return {
    ...actual,
    authenticateDashboard: setPrincipal,
  };
});

vi.mock('@/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  // errorHandler imports logError too - without this stub the error pipeline
  // itself throws and every response collapses to a bare 500.
  logError: vi.fn(),
}));

// SSRF validator stand-in: mirrors the real allowlist semantics (public DNS
// names pass; localhost/private IPs/DNS failures throw).
vi.mock('@/utils/validateUrl.js', () => ({
  validateWebhookUrl: vi.fn(async (url: string) => {
    if (/localhost|127\.0\.0\.1|169\.254|10\.0\.0\.|192\.168\./.test(url)) {
      throw new Error('URLs pointing to private/reserved networks are not allowed');
    }
    if (url.includes('dns-fail.example.com')) {
      throw new Error('Cannot resolve hostname: dns-fail.example.com');
    }
  }),
  getSafeHttpAgent: () => undefined,
  getSafeHttpsAgent: () => undefined,
  SsrfError: class SsrfError extends Error {},
}));

vi.mock('@/services/webhook.js', () => ({
  WebhookService: class {},
  createWebhookSignature: vi.fn(),
}));

let app: Express;

async function buildApp() {
  const mod = await import('../webhooks.js');
  const { errorHandler } = await import('@/middleware/errorHandler.js');
  const a = express();
  a.use(express.json());
  a.use('/api/developer', mod.default);
  // PRODUCTION error pipeline - what the portal actually sees.
  a.use(errorHandler);
  return a;
}

beforeEach(async () => {
  state.dupRows = [];
  state.dupError = null;
  state.insertError = null;
  state.inserted = [];
  app = await buildApp();
});

describe('POST /api/developer/webhooks - acceptance (Ijayo receiver)', () => {
  it('creates the Ijayo compliance webhook with the person event set (201 + whsec_)', async () => {
    const res = await request(app)
      .post('/api/developer/webhooks')
      .set('x-test-principal', 'jwt')
      .send({ url: IJAYO_URL, events: PERSON_EVENTS, api_key_id: null });

    expect(res.status).toBe(201);
    expect(res.body.webhook.url).toBe(IJAYO_URL);
    expect(res.body.webhook.secret_key).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(res.body.webhook.events).toEqual(PERSON_EVENTS);

    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      developer_id: REAL_DEV,
      url: IJAYO_URL,
      api_key_id: null,
    });
  });

  it('accepts the optional KYB (business.*) events when explicitly requested', async () => {
    const res = await request(app)
      .post('/api/developer/webhooks')
      .set('x-test-principal', 'jwt')
      .send({ url: IJAYO_URL, events: [...PERSON_EVENTS, 'business.status.updated'] });

    expect(res.status).toBe(201);
    expect(res.body.webhook.events).toContain('business.status.updated');
  });
});

describe('POST /api/developer/webhooks - known failures must not be 500', () => {
  it('returns 401 when auth middleware set no developer principal', async () => {
    const res = await request(app)
      .post('/api/developer/webhooks')
      .set('x-test-principal', 'none')
      .send({ url: IJAYO_URL });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Developer authentication required');
  });

  it('returns 400 for a non-https URL', async () => {
    const res = await request(app)
      .post('/api/developer/webhooks')
      .set('x-test-principal', 'jwt')
      .send({ url: 'http://ijayo.weareupsyd.com/ijayo/compliance/webhook' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Valid HTTPS webhook URL is required/);
  });

  it('returns 400 (not 500) with the SSRF text for a private IP', async () => {
    const res = await request(app)
      .post('/api/developer/webhooks')
      .set('x-test-principal', 'jwt')
      .send({ url: 'https://192.168.1.10/hook' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/private\/reserved networks/);
  });

  it('returns 400 (not 500) with the DNS-failure text', async () => {
    const res = await request(app)
      .post('/api/developer/webhooks')
      .set('x-test-principal', 'jwt')
      .send({ url: 'https://dns-fail.example.com/hook' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Cannot resolve hostname: dns-fail\.example\.com/);
  });

  it('returns 400 naming the invalid events', async () => {
    const res = await request(app)
      .post('/api/developer/webhooks')
      .set('x-test-principal', 'jwt')
      .send({ url: IJAYO_URL, events: ['verification.completed', 'screen.match_found'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid webhook events: screen\.match_found/);
  });

  it('returns 400 for a duplicate URL (single existing row)', async () => {
    state.dupRows = [
      { id: 'existing-webhook', developer_id: REAL_DEV, url: IJAYO_URL, is_sandbox: false, api_key_id: null },
    ];
    const res = await request(app)
      .post('/api/developer/webhooks')
      .set('x-test-principal', 'jwt')
      .send({ url: IJAYO_URL, events: ['verification.completed'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Webhook already exists for this URL/);
    expect(state.inserted).toHaveLength(0);
  });

  it('returns 400 (not 500) when MULTIPLE duplicate rows already exist', async () => {
    // .single() used to turn this into PGRST116 -> unhandled -> 500.
    state.dupRows = [
      { id: 'dup-1', developer_id: REAL_DEV, url: IJAYO_URL, is_sandbox: false, api_key_id: null },
      { id: 'dup-2', developer_id: REAL_DEV, url: IJAYO_URL, is_sandbox: false, api_key_id: null },
    ];
    const res = await request(app)
      .post('/api/developer/webhooks')
      .set('x-test-principal', 'jwt')
      .send({ url: IJAYO_URL, events: ['verification.completed'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Webhook already exists for this URL/);
  });

  it('returns 400 (not 500) when the duplicate-probe query itself fails', async () => {
    state.dupError = { code: '42501', message: 'permission denied for table webhooks' };
    const res = await request(app)
      .post('/api/developer/webhooks')
      .set('x-test-principal', 'jwt')
      .send({ url: IJAYO_URL, events: ['verification.completed'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/permission denied for table webhooks/);
    expect(res.body.message).toMatch(/code 42501/);
  });

  it('maps a 23505 unique violation on insert to 400 "already exists"', async () => {
    state.insertError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "webhooks_developer_id_url_key"',
    };
    const res = await request(app)
      .post('/api/developer/webhooks')
      .set('x-test-principal', 'jwt')
      .send({ url: IJAYO_URL, events: ['verification.completed'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Webhook already exists for this URL/);
    expect(res.body.code).toBe('WEBHOOK_DUPLICATE');
  });

  it('maps an RLS denial on insert to 400 with the Postgres message', async () => {
    state.insertError = {
      code: '42501',
      message: 'new row violates row-level security policy for table "webhooks"',
    };
    const res = await request(app)
      .post('/api/developer/webhooks')
      .set('x-test-principal', 'jwt')
      .send({ url: IJAYO_URL, events: ['verification.completed'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/row-level security policy/);
    expect(res.body.message).toMatch(/code 42501/);
  });

  it('maps a missing-column insert failure to 400 with the Postgres message', async () => {
    state.insertError = {
      code: '42703',
      message: 'column webhooks.secret_key does not exist',
      hint: 'Perhaps you meant to use column "url".',
    };
    const res = await request(app)
      .post('/api/developer/webhooks')
      .set('x-test-principal', 'jwt')
      .send({ url: IJAYO_URL, events: ['verification.completed'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/column webhooks\.secret_key does not exist/);
    expect(res.body.message).toMatch(/code 42703/);
    expect(res.body.message).toMatch(/hint: Perhaps you meant/i);
  });

  it('maps an FK violation on insert to 400 with the Postgres message', async () => {
    state.insertError = {
      code: '23503',
      message: 'insert or update on table "webhooks" violates foreign key constraint "webhooks_api_key_id_fkey"',
    };
    const res = await request(app)
      .post('/api/developer/webhooks')
      .set('x-test-principal', 'jwt')
      .send({ url: IJAYO_URL, events: ['verification.completed'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/violates foreign key constraint/);
  });

  it('maps the reported webhooks_developer_id_fkey 23503 to actionable migration guidance', async () => {
    // Exact incident from the live combined console: adding a webhook returned
    //   insert or update on table "webhooks" violates foreign key constraint
    //   "webhooks_developer_id_fkey" (code 23503)
    // Root cause: stale webhooks_developer_id_fkey bound to a legacy
    // developers table OID (original unqualified REFERENCES developers(id)),
    // or migrations 66/67/68 not applied. The response must point the
    // operator at the repair rather than dumping a raw FK string.
    state.insertError = {
      code: '23503',
      message: 'insert or update on table "webhooks" violates foreign key constraint "webhooks_developer_id_fkey"',
    };
    const res = await request(app)
      .post('/api/developer/webhooks')
      .set('x-test-principal', 'jwt')
      .send({ url: IJAYO_URL, events: ['verification.completed'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/violates foreign key constraint/);
    expect(res.body.message).toMatch(/npm run migrate/);
    expect(res.body.message).toMatch(/66_repair_webhook_owner_foreign_keys/);
    expect(res.body.message).toMatch(/68_add_aml_webhook_owner/);
    expect(res.body.code).toBe('WEBHOOK_OWNER_FK');
  });
});

describe('GET /api/developer/webhooks - list failures must not be 500', () => {
  it('maps a list-query error to 400 with the Postgres message', async () => {
    // The list path ends in .order(); route the error through it.
    state.dupError = { code: '42P01', message: 'relation "webhooks" does not exist' };
    const res = await request(app)
      .get('/api/developer/webhooks')
      .set('x-test-principal', 'jwt');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/relation "webhooks" does not exist/);
  });
});
