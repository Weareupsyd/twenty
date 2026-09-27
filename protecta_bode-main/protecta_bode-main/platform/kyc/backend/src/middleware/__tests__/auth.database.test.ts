import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ lookup: vi.fn(), write: vi.fn() }));
vi.mock('@/config/database.js', () => ({
  supabase: {
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        single: () => db.lookup(),
        update: () => { db.write(); return chain; },
        insert: () => { db.write(); return chain; },
        then: (resolve: any, reject: any) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
      };
      return chain;
    },
  },
}));
vi.mock('@/config/index.js', () => ({ default: { apiKeySecret: 'test-secret', nodeEnv: 'production' } }));
vi.mock('@/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, logError: vi.fn(),
}));
vi.mock('@/middleware/rateLimit.js', () => ({ basicRateLimit: (_req: any, _res: any, next: any) => next() }));
vi.mock('@/services/storage.js', () => ({ resolvePublicAssetUrl: vi.fn() }));

import { authenticateAPIKey } from '../auth.js';
import { errorHandler } from '../errorHandler.js';
import handoffRoutes from '@/routes/handoff.js';

const app = express();
app.use(express.json());
app.get('/protected', authenticateAPIKey, (_req, res) => res.json({ ok: true }));
app.use('/handoff', handoffRoutes);
app.use(errorHandler);

const key = 'ik_' + 'a'.repeat(64);
const activeKey = {
  id: 'key-id', developer_id: 'dev-id', is_active: true, expires_at: null,
  developer: { id: 'dev-id', status: 'active' },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.lookup.mockResolvedValue({ data: activeKey, error: null });
});

describe('API-key database failures', () => {
  it.each(['28P01', '42P01', 'ECONNREFUSED', undefined])('returns 503, not invalid key, for %s', async code => {
    db.lookup.mockResolvedValue({ data: null, error: { code, message: 'private DB credentials/host' } });
    const response = await request(app).get('/protected').set('X-API-Key', key);
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(response.text).not.toContain('Invalid API key');
    expect(response.text).not.toContain('private DB');
    expect(db.write).not.toHaveBeenCalled();
  });

  it('maps a thrown connection error to service unavailable', async () => {
    db.lookup.mockRejectedValue(new Error('connection lost'));
    expect((await request(app).get('/protected').set('X-API-Key', key)).status).toBe(503);
  });

  it('still rejects a genuinely missing key with 401', async () => {
    db.lookup.mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'Row not found' } });
    const response = await request(app).get('/protected').set('X-API-Key', key);
    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid API key');
    expect(db.write).not.toHaveBeenCalled();
  });

  it('rejects a missing header without a database lookup', async () => {
    expect((await request(app).get('/protected')).status).toBe(401);
    expect(db.lookup).not.toHaveBeenCalled();
  });

  it('accepts a valid key and preserves expiration/suspension checks', async () => {
    expect((await request(app).get('/protected').set('X-API-Key', key)).status).toBe(200);
    db.lookup.mockResolvedValue({ data: { ...activeKey, expires_at: '2000-01-01' }, error: null });
    expect((await request(app).get('/protected').set('X-API-Key', key)).status).toBe(401);
    db.lookup.mockResolvedValue({ data: { ...activeKey, developer: { status: 'suspended' } }, error: null });
    expect((await request(app).get('/protected').set('X-API-Key', key)).status).toBe(403);
  });
});

describe('handoff creation database failures', () => {
  it('reports failed API-key lookup as 503 without creating a handoff', async () => {
    db.lookup.mockResolvedValue({ data: null, error: { code: '28P01', message: 'private DB details' } });
    const response = await request(app).post('/handoff/create').send({ api_key: key, user_id: 'test-user' });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(response.text).not.toContain('private DB details');
    expect(db.write).not.toHaveBeenCalled();
  });

  it('reports failed session-token lookup as 503', async () => {
    db.lookup.mockResolvedValue({ data: null, error: { code: '28P01' } });
    const response = await request(app).post('/handoff/create').set('X-Session-Token', 'a'.repeat(64)).send({});
    expect(response.status).toBe(503);
    expect(db.write).not.toHaveBeenCalled();
  });

  it('still reports an unknown API key as 401', async () => {
    db.lookup.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
    const response = await request(app).post('/handoff/create').send({ api_key: key, user_id: 'test-user' });
    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid API key');
    expect(db.write).not.toHaveBeenCalled();
  });

  it('creates a handoff when the database and key are valid', async () => {
    const response = await request(app).post('/handoff/create').send({ api_key: key, user_id: 'test-user' });
    expect(response.status).toBe(201);
    expect(response.body.token).toMatch(/^[a-f0-9]{64}$/);
  });
});
