import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), from: vi.fn(), select: vi.fn() }));
vi.mock('@/config/database.js', () => ({
  supabase: {
    from: (table: string) => {
      db.from(table);
      return {
        select: (columns: string) => {
          db.select(columns);
          return { limit: (count: number) => db.query(table, columns, count) };
        },
      };
    },
  },
}));
vi.mock('@/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logError: vi.fn(),
}));

import healthRoutes from '../health.js';

const app = express();
app.use('/api/health', healthRoutes);

beforeEach(() => {
  vi.clearAllMocks();
  db.query.mockResolvedValue({ data: [], error: null });
});
afterEach(() => vi.useRealTimers());

describe('database readiness', () => {
  it('accepts empty, migrated tables without requiring first-run setup', async () => {
    const response = await request(app).get('/api/health/ready');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(db.from.mock.calls.map(([table]) => table)).toEqual([
      'users', 'developers', 'api_keys', 'verification_requests', 'mobile_handoff_sessions',
      'verification_contexts',
    ]);
    const verificationQuery = db.query.mock.calls.find(([table]) => table === 'verification_requests')!;
    expect(verificationQuery[1].split(',')).toEqual(expect.arrayContaining([
      'id', 'user_id', 'developer_id', 'status', 'ocr_data', 'source', 'is_sandbox', 'addons',
      'verification_mode', 'age_threshold', 'step_timestamps', 'session_started_at',
      'client_ip', 'api_key_id', 'manual_review_reason',
      'external_reference', 'external_system', 'subject_type', 'external_user_id',
      'odoo_partner_id', 'odoo_guarantor_id', 'odoo_lead_id',
      'session_token_hash', 'session_token_expires_at', 'session_api_key_id',
    ]));
    // Check column existence without loading personal data or credential hashes.
    expect(db.query.mock.calls.every(([, , limit]) => limit === 0)).toBe(true);
  });

  it.each(['28P01', '42P01', '42703', 'ECONNREFUSED'])('returns 503 for a returned %s error', async code => {
    db.query.mockResolvedValue({ data: null, error: { code, message: 'private database details' } });
    const response = await request(app).get('/api/health/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready', error: 'Database not available' });
    expect(response.text).not.toContain('private database details');
    expect(response.text).not.toContain(code);
  });

  it('does not declare readiness when users exists but key migrations failed', async () => {
    db.query.mockImplementation(async table => ({
      data: [], error: table === 'api_keys' ? { code: '42P01' } : null,
    }));
    expect((await request(app).get('/api/health/ready')).status).toBe(503);
  });

  it.each(['ocr_data', 'addons', 'step_timestamps', 'session_token_hash', 'external_user_id'])(
    'rejects an existing verification table missing %s, then recovers after repair', async missingColumn => {
      // SELECT id would succeed; only an explicit projection catches this drift.
      db.query.mockImplementation(async (table, columns) => ({
        data: [],
        error: table === 'verification_requests' && columns.split(',').includes(missingColumn)
          ? { code: '42703', message: `column ${missingColumn} does not exist` }
          : null,
      }));
      const response = await request(app).get('/api/health/ready');
      expect(response.status).toBe(503);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({ status: 'not_ready', error: 'Database not available' });
      db.query.mockResolvedValue({ data: [], error: null });
      expect((await request(app).get('/api/health/ready')).status).toBe(200);
    },
  );

  it('requires session persistence even when verification_requests exists', async () => {
    db.query.mockImplementation(async table => ({
      data: [], error: table === 'verification_contexts' ? { code: '42P01' } : null,
    }));
    expect((await request(app).get('/api/health/ready')).status).toBe(503);
  });

  it('handles a thrown driver error and recovers on the next probe', async () => {
    db.query.mockRejectedValue(new Error('connection lost'));
    expect((await request(app).get('/api/health/ready')).status).toBe(503);
    db.query.mockResolvedValue({ data: [], error: null });
    expect((await request(app).get('/api/health/ready')).status).toBe(200);
  });

  it('bounds a stalled query to five seconds', async () => {
    vi.useFakeTimers();
    db.query.mockImplementation(() => new Promise(() => {}));
    // Call the real route handler without introducing HTTP socket timers.
    const layer = healthRoutes.stack.find(layer => layer.route?.path === '/ready')!;
    const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    const pending = layer.route.stack[0].handle({}, res, next);
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the probe timeout after a successful query', async () => {
    vi.useFakeTimers();
    const layer = healthRoutes.stack.find(layer => layer.route?.path === '/ready')!;
    const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    await layer.route.stack[0].handle({}, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps liveness separate from database readiness', async () => {
    db.query.mockRejectedValue(new Error('database unavailable'));
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/api/health/live')).status).toBe(200);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('uses the same real query for detailed health (not a nonexistent count column)', async () => {
    const healthy = await request(app).get('/api/health/detailed');
    expect(healthy.status).toBe(200);
    expect(healthy.body.services.database.status).toBe('up');
    expect(db.select).not.toHaveBeenCalledWith('count');
    db.query.mockResolvedValue({ data: null, error: { code: '28P01' } });
    const unhealthy = await request(app).get('/api/health/detailed');
    expect(unhealthy.status).toBe(503);
    expect(unhealthy.body.services.database.status).toBe('down');
  });
});
