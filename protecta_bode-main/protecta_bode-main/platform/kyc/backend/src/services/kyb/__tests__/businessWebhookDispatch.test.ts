/**
 * Business webhook dispatch tests.
 *
 * The signing algorithm is covered in kyb.test.ts. What matters here is the
 * delivery behaviour: who gets the event, what the receiver can verify, and
 * that a broken endpoint never becomes the caller's problem.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// ── Mocks ──────────────────────────────────────────────────────────────────

let mockWebhooks: any[] = [];
const insertedDeliveries: any[] = [];
const updatedDeliveries: any[] = [];

vi.mock('@/config/database.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'webhooks') {
        const b: any = {
          select: () => b,
          eq: () => b,
          then: (res: any) => res({ data: mockWebhooks, error: null }),
        };
        return b;
      }
      // webhook_deliveries
      const b: any = {
        insert: (row: any) => {
          insertedDeliveries.push(row);
          return {
            select: () => ({
              single: () => ({ data: { id: `del_${insertedDeliveries.length}` }, error: null }),
            }),
          };
        },
        update: (row: any) => ({
          eq: (_c: string, id: string) => {
            updatedDeliveries.push({ id, ...row });
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };
      return b;
    },
  },
  connectDB: vi.fn(),
}));

vi.mock('@/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logError: vi.fn(),
  logWebhookDelivery: vi.fn(),
}));

vi.mock('@/config/index.js', () => ({
  default: {
    encryptionKey: 'k'.repeat(32),
    webhooks: { retryAttempts: 3, timeoutMs: 5000 },
  },
}));

vi.mock('@kabila/shared', () => ({
  decryptSecret: (v: string) => v, // secrets stored plaintext in these tests
  encryptSecret: (v: string) => v,
}));

const validateWebhookUrl = vi.fn(async () => {});
class SsrfError extends Error {}
vi.mock('@/utils/validateUrl.js', () => ({
  validateWebhookUrl: (u: string) => validateWebhookUrl(u),
  getSafeHttpAgent: () => undefined,
  getSafeHttpsAgent: () => undefined,
  SsrfError,
}));

const axiosPost = vi.fn();
vi.mock('axios', () => ({ default: { post: (...a: any[]) => axiosPost(...a) } }));

const { dispatchBusinessWebhook, fireBusinessStatusChanged, getBusinessWebhooks } =
  await import('../businessWebhookDispatch.js');
const { verifyRawSignature, SIGNATURE_HEADER } = await import('../businessWebhook.js');

const BASE = {
  developerId: 'dev-1',
  applicationId: 'app-1',
  sessionId: 'bs_01H',
  status: 'APPROVED',
  previousStatus: 'IN_PROGRESS',
  vendorData: 'biz-acme-001',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockWebhooks = [];
  insertedDeliveries.length = 0;
  updatedDeliveries.length = 0;
  axiosPost.mockResolvedValue({ status: 200, data: 'ok' });
  validateWebhookUrl.mockResolvedValue(undefined);
});

// ── Subscription ───────────────────────────────────────────────────────────
describe('who receives a business event', () => {
  it('sends to endpoints subscribed to the event', async () => {
    mockWebhooks = [{ id: 'w1', url: 'https://a.test/hook', events: ['business.status.updated'], is_active: true }];
    const out = await dispatchBusinessWebhook({ event: 'business.status.updated', ...BASE });
    expect(out).toEqual({ attempted: 1, delivered: 1, failed: 0 });
  });

  it('does NOT send business events to a webhook that never opted in', async () => {
    // An integration predating KYB subscribes only to person events. Sending
    // it a business payload would break a handler that has no branch for it.
    mockWebhooks = [{ id: 'w1', url: 'https://a.test/hook', events: ['verification.completed'], is_active: true }];
    const out = await dispatchBusinessWebhook({ event: 'business.status.updated', ...BASE });
    expect(out.attempted).toBe(0);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('does not treat a null events list as "everything"', async () => {
    mockWebhooks = [{ id: 'w1', url: 'https://a.test/hook', events: null, is_active: true }];
    expect(await getBusinessWebhooks('dev-1', 'business.status.updated')).toHaveLength(0);
  });

  it('fans out to every subscribed endpoint', async () => {
    mockWebhooks = [
      { id: 'w1', url: 'https://a.test/hook', events: ['business.status.updated'] },
      { id: 'w2', url: 'https://b.test/hook', events: ['business.status.updated'] },
    ];
    const out = await dispatchBusinessWebhook({ event: 'business.status.updated', ...BASE });
    expect(out.delivered).toBe(2);
    expect(axiosPost).toHaveBeenCalledTimes(2);
  });
});

// ── Payload + signature ────────────────────────────────────────────────────
describe('payload and signature', () => {
  it('carries session_kind business so receivers can route on it', async () => {
    mockWebhooks = [{ id: 'w1', url: 'https://a.test/hook', events: ['business.status.updated'] }];
    await dispatchBusinessWebhook({ event: 'business.status.updated', ...BASE });

    const body = JSON.parse(axiosPost.mock.calls[0][1]);
    expect(body.data.session_kind).toBe('business');
    expect(body.data.business_session_id).toBe('bs_01H');
    expect(body.data.status).toBe('APPROVED');
    expect(body.data.previous_status).toBe('IN_PROGRESS');
    expect(body.event).toBe('business.status.updated');
  });

  it('signs with X-Signature-V2, verifiable against the exact bytes sent', async () => {
    mockWebhooks = [{ id: 'w1', url: 'https://a.test/hook', events: ['business.status.updated'], secret_key: 'shh' }];
    await dispatchBusinessWebhook({ event: 'business.status.updated', ...BASE });

    const [, body, cfg] = axiosPost.mock.calls[0];
    const sig = cfg.headers[SIGNATURE_HEADER];
    expect(sig).toMatch(/^[0-9a-f]{64}$/);

    // This is the contract: the receiver HMACs the raw body and compares.
    expect(verifyRawSignature(Buffer.from(body), sig, 'shh')).toBe(true);
    expect(verifyRawSignature(Buffer.from(body), sig, 'wrong')).toBe(false);
  });

  it('sends the canonical bytes it signed', async () => {
    mockWebhooks = [{ id: 'w1', url: 'https://a.test/hook', events: ['business.status.updated'], secret_key: 'shh' }];
    await dispatchBusinessWebhook({ event: 'business.status.updated', ...BASE });

    const [, body, cfg] = axiosPost.mock.calls[0];
    const expected = crypto.createHmac('sha256', 'shh').update(Buffer.from(body)).digest('hex');
    expect(cfg.headers[SIGNATURE_HEADER]).toBe(expected);
  });

  it('omits the signature when no secret is configured', async () => {
    mockWebhooks = [{ id: 'w1', url: 'https://a.test/hook', events: ['business.status.updated'] }];
    await dispatchBusinessWebhook({ event: 'business.status.updated', ...BASE });
    expect(axiosPost.mock.calls[0][2].headers[SIGNATURE_HEADER]).toBeUndefined();
  });
});

// ── Failure handling ───────────────────────────────────────────────────────
describe('failure handling', () => {
  it('retries a 500 up to the attempt budget, then records failure', async () => {
    mockWebhooks = [{ id: 'w1', url: 'https://a.test/hook', events: ['business.status.updated'] }];
    axiosPost.mockResolvedValue({ status: 500, data: 'boom' });

    const out = await dispatchBusinessWebhook({ event: 'business.status.updated', ...BASE });
    expect(axiosPost).toHaveBeenCalledTimes(3);
    expect(out.failed).toBe(1);
    expect(updatedDeliveries.at(-1)).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('stops retrying once an attempt succeeds', async () => {
    mockWebhooks = [{ id: 'w1', url: 'https://a.test/hook', events: ['business.status.updated'] }];
    axiosPost.mockResolvedValueOnce({ status: 503, data: '' }).mockResolvedValueOnce({ status: 200, data: 'ok' });

    const out = await dispatchBusinessWebhook({ event: 'business.status.updated', ...BASE });
    expect(axiosPost).toHaveBeenCalledTimes(2);
    expect(out.delivered).toBe(1);
    expect(updatedDeliveries.at(-1)).toMatchObject({ status: 'delivered' });
  });

  it('does not retry an SSRF rejection - the destination will not become allowed', async () => {
    mockWebhooks = [{ id: 'w1', url: 'http://169.254.169.254/', events: ['business.status.updated'] }];
    validateWebhookUrl.mockRejectedValue(new SsrfError('blocked'));

    const out = await dispatchBusinessWebhook({ event: 'business.status.updated', ...BASE });
    expect(axiosPost).not.toHaveBeenCalled();
    expect(out.failed).toBe(1);
  });

  it('records a delivery row for the business session, not a verification', async () => {
    mockWebhooks = [{ id: 'w1', url: 'https://a.test/hook', events: ['business.status.updated'] }];
    await dispatchBusinessWebhook({ event: 'business.status.updated', ...BASE });

    expect(insertedDeliveries[0]).toMatchObject({
      webhook_id: 'w1',
      business_session_id: 'bs_01H',
      verification_request_id: null,
    });
  });

  it('never throws at the caller when everything is broken', async () => {
    mockWebhooks = [{ id: 'w1', url: 'https://a.test/hook', events: ['business.status.updated'] }];
    axiosPost.mockRejectedValue(new Error('network down'));
    await expect(dispatchBusinessWebhook({ event: 'business.status.updated', ...BASE })).resolves.toMatchObject({ failed: 1 });
  });
});

// ── Change detection ───────────────────────────────────────────────────────
describe('status-change firing', () => {
  it('does not fire when the status did not actually change', async () => {
    mockWebhooks = [{ id: 'w1', url: 'https://a.test/hook', events: ['business.status.updated'] }];
    fireBusinessStatusChanged({ ...BASE, status: 'IN_REVIEW', previousStatus: 'IN_REVIEW' });
    await new Promise((r) => setTimeout(r, 10));
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('fires when it did', async () => {
    mockWebhooks = [{ id: 'w1', url: 'https://a.test/hook', events: ['business.status.updated'] }];
    fireBusinessStatusChanged({ ...BASE, status: 'APPROVED', previousStatus: 'IN_REVIEW' });
    await new Promise((r) => setTimeout(r, 10));
    expect(axiosPost).toHaveBeenCalledTimes(1);
  });
});
