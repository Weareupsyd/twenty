/**
 * Regression tests for staff-owned AML webhook creation (compliance/webhooks.ts).
 *
 * Incident: adding a webhook from the AML console failed with
 *   insert or update on table "webhooks" violates foreign key constraint
 *   "webhooks_developer_id_fkey" (code 23503)
 *
 * The staff path must NEVER write developer_id - it inserts developer_id: null
 * and owns the row via compliance_staff_id + owner_type='staff', so the
 * developer FK is structurally unreachable for AML webhooks. These tests lock
 * that contract in and assert that pre-migration DB states (23503 FK miss,
 * 42703 missing compliance_staff_id column) map to actionable errors instead
 * of raw Postgres dumps.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const STAFF_ID = '11111111-1111-4111-8111-111111111111';
const URL = 'https://ops.upsyd.com/compliance';

const state = vi.hoisted(() => ({
  // Error the insert should return (null = success).
  insertError: null as any,
  // Captured rows passed to .insert().
  inserted: [] as any[],
}));

vi.mock('@/config/database.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'webhooks') {
        throw new Error(`Unexpected table in test: ${table}`);
      }
      return {
        insert: (row: any) => {
          state.inserted.push(row);
          if (state.insertError) {
            return {
              select: () => ({
                single: () => Promise.resolve({ data: null, error: state.insertError }),
              }),
            };
          }
          const created = {
            ...row,
            id: 'created-staff-webhook-uuid',
            is_active: true,
            created_at: '2026-08-29T00:00:00Z',
          };
          return {
            select: () => ({
              single: () => Promise.resolve({ data: created, error: null }),
            }),
          };
        },
      };
    },
  },
}));

vi.mock('@/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logError: vi.fn(),
}));

// @kabila/shared may not be installed in sparse test worktrees; it is only used
// for secret decrypt which these tests do not exercise.
vi.mock('@kabila/shared', () => ({
  decryptSecret: vi.fn((s: string) => s),
}));

async function loadCreateStaffWebhook() {
  const mod = await import('../webhooks.js');
  return mod.createStaffWebhook;
}

beforeEach(() => {
  state.insertError = null;
  state.inserted = [];
});

describe('createStaffWebhook - ownership contract (never touches developer_id)', () => {
  it('inserts developer_id: null with compliance_staff_id + owner_type staff', async () => {
    const createStaffWebhook = await loadCreateStaffWebhook();
    const webhook = await createStaffWebhook({
      staffId: STAFF_ID,
      url: URL,
      events: ['aml.screening.completed'],
    });

    expect(webhook.id).toBe('created-staff-webhook-uuid');
    expect(state.inserted).toHaveLength(1);

    const row = state.inserted[0];
    // THE core regression guard: the AML/staff insert must never populate
    // developer_id, so webhooks_developer_id_fkey cannot fire for it.
    expect(row.developer_id).toBeNull();
    expect(row.compliance_staff_id).toBe(STAFF_ID);
    expect(row.owner_type).toBe('staff');
    expect(row.api_key_id).toBeNull();
    expect(row.url).toBe(URL);
    expect(row.is_sandbox).toBe(false);
    expect(row.events).toEqual(['aml.screening.completed']);
    // Auto-generated signing secret when none provided
    expect(row.secret_key).toMatch(/^whsec_[0-9a-f]{48}$/);
  });

  it('defaults the event set to the person-verification events when none given', async () => {
    const createStaffWebhook = await loadCreateStaffWebhook();
    await createStaffWebhook({ staffId: STAFF_ID, url: URL });

    const row = state.inserted[0];
    expect(row.events.length).toBeGreaterThan(0);
    expect(row.events).toContain('verification.completed');
    expect(row.events).not.toContain('business.status.updated');
  });

  it('rejects invalid event names before touching the database', async () => {
    const createStaffWebhook = await loadCreateStaffWebhook();
    await expect(
      createStaffWebhook({ staffId: STAFF_ID, url: URL, events: ['not.a.real.event'] })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Invalid webhook events/) });

    expect(state.inserted).toHaveLength(0);
  });
});

describe('createStaffWebhook - pre-migration DB states map to actionable errors', () => {
  it('maps a 23503 (staff owner FK miss) to WEBHOOK_OWNER_FK with migration guidance', async () => {
    const createStaffWebhook = await loadCreateStaffWebhook();
    state.insertError = {
      code: '23503',
      message: 'insert or update on table "webhooks" violates foreign key constraint "webhooks_compliance_staff_id_fkey"',
    };

    const err = await createStaffWebhook({ staffId: STAFF_ID, url: URL }).catch((e: Error & { status?: number; code?: string }) => e);
    expect(err.status).toBe(400);
    expect(err.code).toBe('WEBHOOK_OWNER_FK');
    expect((err as Error).message).toMatch(/68_add_aml_webhook_owner/);
    expect((err as Error).message).toMatch(/compliance\.staff/);
  });

  it('maps a 42703 (migration 68 not applied -> compliance_staff_id missing) to WEBHOOK_MIGRATION_REQUIRED', async () => {
    const createStaffWebhook = await loadCreateStaffWebhook();
    state.insertError = {
      code: '42703',
      message: 'column webhooks.compliance_staff_id does not exist',
    };

    const err = await createStaffWebhook({ staffId: STAFF_ID, url: URL }).catch((e: Error & { status?: number; code?: string }) => e);
    expect(err.status).toBe(400);
    expect(err.code).toBe('WEBHOOK_MIGRATION_REQUIRED');
    expect((err as Error).message).toMatch(/npm run migrate/);
    expect((err as Error).message).toMatch(/68_add_aml_webhook_owner/);
  });

  it('maps a 23505 duplicate to WEBHOOK_DUPLICATE', async () => {
    const createStaffWebhook = await loadCreateStaffWebhook();
    state.insertError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "webhooks_developer_id_url_key"',
    };

    const err = await createStaffWebhook({ staffId: STAFF_ID, url: URL }).catch((e: Error & { status?: number; code?: string }) => e);
    expect(err.status).toBe(400);
    expect(err.code).toBe('WEBHOOK_DUPLICATE');
    expect((err as Error).message).toMatch(/already exists/);
  });
});
