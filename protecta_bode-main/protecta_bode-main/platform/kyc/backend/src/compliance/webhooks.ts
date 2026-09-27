/**
 * AML / compliance-staff webhook management.
 *
 * The original `public.webhooks` table was developer-only (FK to
 * public.developers). The AML console needs to register webhooks for
 * screening events without a developer account. Attempting to insert a
 * staff UUID into developer_id violated `webhooks_developer_id_fkey`
 * (SQLSTATE 23503).
 *
 * Migration 68 adds `compliance_staff_id` and makes `developer_id` nullable
 * with an owner_type discriminator. This module exposes CRUD for staff-owned
 * webhooks under /api/aml/webhooks and /api/compliance/webhooks (both mounted
 * via compliance/routes.ts).
 *
 * Security:
 *   - Staff webhooks are isolated by compliance_staff_id = auth.uid()
 *   - They cannot be scoped to api_key_id (staff have no API keys)
 *   - Secret handling mirrors developer/webhooks.ts (plaintext secret_key,
 *     masked in list)
 */

import crypto from 'crypto';
import { supabase } from '@/config/database.js';
import { logger } from '@/utils/logger.js';
import { withWebhookSchemaHeal, isWebhookSchemaError } from '@/services/webhookSchema.js';
import { decryptSecret } from '@kabila/shared';
import config from '@/config/index.js';
import { WEBHOOK_EVENT_NAMES, DEFAULT_WEBHOOK_EVENT_NAMES } from '@/constants/webhookEvents.js';

function decryptStoredWebhookSecret(stored: string): string {
  try {
    return decryptSecret(stored, config.encryptionKey);
  } catch {
    return stored;
  }
}

export interface StaffWebhookRow {
  id: string;
  url: string;
  is_sandbox: boolean;
  is_active: boolean;
  events: string[] | null;
  secret_key: string | null;
  secret_token: string | null;
  compliance_staff_id: string | null;
  developer_id: string | null;
  owner_type: string;
  created_at: string;
}

/**
 * Run a staff-webhook query, self-healing the owner schema once if the
 * database is behind (missing compliance_staff_id / owner_type, stale FK).
 *
 * `degradeToEmpty` answers "what did the console ask for?" when the repair is
 * not possible from this process: a database with no owner columns cannot hold
 * a staff-owned webhook, so an empty result is the truthful answer - and the
 * AML console stays usable - rather than a 500 whose only remedy is a
 * migration. Writes never degrade: they must report the failure.
 */
async function runStaffWebhookQuery<T extends { error?: any }>(
  build: () => Promise<T>,
  opts: { label: string; degradeToEmpty?: T }
): Promise<T> {
  const { result } = await withWebhookSchemaHeal(build, { label: opts.label });
  const error = (result as any)?.error;
  if (error && isWebhookSchemaError(error) && opts.degradeToEmpty) {
    logger.warn('Staff webhook query degraded to an empty result - AML webhook owner schema unavailable', {
      label: opts.label,
      code: error.code,
      message: error.message,
    });
    return opts.degradeToEmpty;
  }
  return result;
}

export async function listStaffWebhooks(staffId: string): Promise<StaffWebhookRow[]> {
  const { data, error } = await runStaffWebhookQuery(
    () => supabase
      .from('webhooks')
      .select('id, url, is_sandbox, is_active, created_at, events, secret_key, compliance_staff_id, developer_id, owner_type')
      .eq('compliance_staff_id', staffId)
      .eq('owner_type', 'staff')
      .order('created_at', { ascending: false }),
    { label: 'staff-webhook-list', degradeToEmpty: { data: [], error: null } as any }
  );

  if (error) {
    logger.error('Failed to list staff webhooks:', error);
    throw new Error('Failed to list webhooks');
  }
  return (data ?? []) as StaffWebhookRow[];
}

export async function createStaffWebhook(opts: {
  staffId: string;
  url: string;
  is_sandbox?: boolean;
  events?: string[];
  secret?: string;
}): Promise<StaffWebhookRow & { secret_key: string }> {
  const secretKey = opts.secret || `whsec_${crypto.randomBytes(24).toString('hex')}`;

  // Validate events
  if (opts.events && opts.events.length > 0) {
    const invalid = opts.events.filter((e) => !WEBHOOK_EVENT_NAMES.includes(e));
    if (invalid.length > 0) {
      throw Object.assign(new Error(`Invalid webhook events: ${invalid.join(', ')}`), { status: 400 });
    }
  }

  // Self-heal once on a schema-shaped failure: staff webhooks need
  // developer_id to be nullable plus the compliance_staff_id / owner_type
  // columns (migration 68). Where that never landed, the first save repairs
  // the table and retries instead of 400ing with "migration required".
  const { result: staffInsert } = await withWebhookSchemaHeal(
    () => supabase
      .from('webhooks')
      .insert({
        developer_id: null,
        compliance_staff_id: opts.staffId,
        owner_type: 'staff',
        url: opts.url,
        is_sandbox: opts.is_sandbox ?? false,
        events: opts.events && opts.events.length > 0 ? opts.events : DEFAULT_WEBHOOK_EVENT_NAMES,
        secret_key: secretKey,
        api_key_id: null,
      })
      .select('id, url, is_sandbox, is_active, created_at, events, secret_key, compliance_staff_id, developer_id, owner_type')
      .single(),
    { label: 'staff-webhook-create' }
  );
  const { data, error } = staffInsert as any;

  if (error || !data) {
    logger.error('Failed to create staff webhook:', {
      code: error?.code,
      message: error?.message,
      details: (error as any)?.details,
      hint: (error as any)?.hint,
    });
    // Map FK violation to actionable error
    if ((error as any)?.code === '23503') {
      throw Object.assign(
        new Error(
          `Failed to create webhook: staff owner not found in compliance.staff (code 23503). ` +
            `The AML webhook ownership schema was checked on this write; if the row still fails, ` +
            `compliance.staff has no record for this session - re-login as the staff user, or run ` +
            `\`npm run db:repair-webhooks\` / ./scripts/repair-webhooks.sh to apply ` +
            `68_add_aml_webhook_owner. ` +
            `Original: ${error.message}`
        ),
        { status: 400, code: 'WEBHOOK_OWNER_FK' }
      );
    }
    // Undefined column (compliance_staff_id / owner_type) means the AML webhook
    // owner schema is absent. The in-process self-heal above normally adds it
    // and retries; reaching here means this process may not run DDL (a
    // Supabase-managed database), so name the repair the operator can run.
    if ((error as any)?.code === '42703') {
      throw Object.assign(
        new Error(
          `Failed to create webhook: this database is missing the AML webhook owner columns ` +
            `(compliance_staff_id / owner_type) - migration 68_add_aml_webhook_owner.sql has not ` +
            `been applied and the app could not repair it from this process. Run ` +
            `\`npm run db:repair-webhooks\` in backend-node/backend (or \`./scripts/repair-webhooks.sh\` ` +
            `in the compliance-stack, which needs no rebuild), then retry. Original: ${error.message}`
        ),
        { status: 400, code: 'WEBHOOK_MIGRATION_REQUIRED' }
      );
    }
    if ((error as any)?.code === '23505') {
      throw Object.assign(new Error('Webhook already exists for this URL'), { status: 400, code: 'WEBHOOK_DUPLICATE' });
    }
    throw Object.assign(new Error(error?.message || 'Failed to create webhook'), { status: 400, code: (error as any)?.code || 'WEBHOOK_DB_ERROR' });
  }

  return data as StaffWebhookRow & { secret_key: string };
}

export async function getStaffWebhookById(staffId: string, webhookId: string): Promise<StaffWebhookRow | null> {
  const { data, error } = await runStaffWebhookQuery(
    () => supabase
      .from('webhooks')
      .select('id, url, is_sandbox, is_active, created_at, events, secret_key, secret_token, compliance_staff_id, developer_id, owner_type')
      .eq('id', webhookId)
      .eq('compliance_staff_id', staffId)
      .eq('owner_type', 'staff')
      .single(),
    { label: 'staff-webhook-get', degradeToEmpty: { data: null, error: null } as any }
  );

  if (error) {
    if ((error as any).code === 'PGRST116') return null;
    logger.error('Failed to get staff webhook:', error);
    throw new Error('Failed to get webhook');
  }
  return (data as StaffWebhookRow) ?? null;
}

export async function deleteStaffWebhook(staffId: string, webhookId: string): Promise<void> {
  const { error } = await runStaffWebhookQuery(
    () => supabase
      .from('webhooks')
      .delete()
      .eq('id', webhookId)
      .eq('compliance_staff_id', staffId)
      .eq('owner_type', 'staff'),
    { label: 'staff-webhook-delete', degradeToEmpty: { error: null } as any }
  );

  if (error) {
    logger.error('Failed to delete staff webhook:', error);
    throw new Error('Failed to delete webhook');
  }
}

export async function getStaffWebhookSecret(staffId: string, webhookId: string): Promise<string | null> {
  const row = await getStaffWebhookById(staffId, webhookId);
  if (!row) return null;
  const stored = row.secret_key || row.secret_token;
  if (!stored) return null;
  return decryptStoredWebhookSecret(stored);
}

/**
 * Fetch active staff-owned webhooks subscribed to an event.
 * Used by AML dispatch (e.g., screening completed, case status).
 */
export async function getActiveStaffWebhooksForEvent(eventType: string): Promise<StaffWebhookRow[]> {
  try {
    const { data, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('owner_type', 'staff')
      .eq('is_active', true);

    if (error) {
      logger.error('Failed to load staff webhooks for event:', { eventType, error: error.message });
      return [];
    }

    return ((data ?? []) as StaffWebhookRow[]).filter(
      (w) => !w.events || w.events.length === 0 || w.events.includes(eventType)
    );
  } catch (err) {
    logger.error('Unexpected error fetching staff webhooks:', err);
    return [];
  }
}
