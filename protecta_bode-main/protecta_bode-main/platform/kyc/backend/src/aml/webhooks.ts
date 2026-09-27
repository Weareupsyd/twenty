/**
 * AML webhook dispatch - staff-owned webhooks for screening/case events.
 *
 * Mirrors businessWebhookDispatch but for AML events owned by compliance.staff.
 * Staff webhooks are stored in public.webhooks with owner_type='staff' and
 * compliance_staff_id set. They are NOT filtered by developer_id.
 *
 * Delivery is fire-and-forget; failures are logged but never block screening.
 */

import axios from 'axios';
import { supabase } from '@/config/database.js';
import config from '@/config/index.js';
import { logger } from '@/utils/logger.js';
import { decryptSecret } from '@kabila/shared';
import { validateWebhookUrl, getSafeHttpAgent, getSafeHttpsAgent, SsrfError } from '@/utils/validateUrl.js';
import { withWebhookSchemaHeal } from '@/services/webhookSchema.js';

interface WebhookRow {
  id: string;
  url: string;
  secret_key?: string | null;
  secret_token?: string | null;
  events?: string[] | null;
  is_active?: boolean;
}

function decryptWebhookSecret(ciphertext: string): string | null {
  try {
    return decryptSecret(ciphertext, config.encryptionKey);
  } catch {
    return ciphertext;
  }
}

export async function getAmlWebhooks(eventType: string): Promise<WebhookRow[]> {
  // The owner_type predicate is exactly what a database without migration 68
  // cannot answer - and a swallowed error here means AML webhooks silently
  // never fire, with nothing in the delivery log and no failed request to
  // notice. Heal once (which adds the column) and re-read before giving up.
  const { result } = await withWebhookSchemaHeal(
    () => supabase
      .from('webhooks')
      .select('*')
      .eq('owner_type', 'staff')
      .eq('is_active', true),
    { label: 'aml-webhook-read' }
  );
  const { data, error } = result as any;

  if (error) {
    logger.error('Failed to load AML webhooks', { eventType, error: error.message });
    return [];
  }

  return ((data ?? []) as WebhookRow[]).filter(
    (w) => !w.events || w.events.length === 0 || w.events.includes(eventType)
  );
}

async function recordDelivery(
  webhookId: string,
  payload: unknown,
  screeningRef?: string | null
): Promise<string | null> {
  const { result } = await withWebhookSchemaHeal(
    () => supabase
      .from('webhook_deliveries')
      .insert({
        webhook_id: webhookId,
        business_session_id: null,
        verification_request_id: null,
        aml_screening_reference: screeningRef || null,
        payload,
        status: 'pending',
        attempts: 0,
      })
      .select('id')
      .single(),
    { label: 'aml-delivery-record' }
  );
  const { data, error } = result as any;

  if (error) {
    logger.error('Failed to record AML webhook delivery', { webhookId, error: error.message });
    return null;
  }
  return (data as { id: string }).id;
}

async function markDelivery(
  deliveryId: string | null,
  status: 'delivered' | 'failed',
  attempts: number,
  responseStatus?: number,
  responseBody?: string
): Promise<void> {
  if (!deliveryId) return;
  await supabase
    .from('webhook_deliveries')
    .update({
      status,
      attempts,
      response_status: responseStatus ?? null,
      response_body: responseBody ? String(responseBody).slice(0, 2000) : null,
      ...(status === 'delivered' ? { delivered_at: new Date().toISOString() } : {}),
    })
    .eq('id', deliveryId);
}

export interface AmlDispatchArgs {
  event: string;
  screening_reference?: string | null;
  data: Record<string, unknown>;
}

export async function dispatchAmlWebhook(args: AmlDispatchArgs): Promise<{ attempted: number; delivered: number; failed: number }> {
  const outcome = { attempted: 0, delivered: 0, failed: 0 };

  let webhooks: WebhookRow[];
  try {
    webhooks = await getAmlWebhooks(args.event);
  } catch (err) {
    logger.error('AML webhook lookup failed', {
      event: args.event,
      error: err instanceof Error ? err.message : String(err),
    });
    return outcome;
  }

  if (webhooks.length === 0) return outcome;

  const payload = {
    event: args.event,
    timestamp: new Date().toISOString(),
    screening_reference: args.screening_reference || null,
    data: args.data,
  };

  const maxAttempts = Math.max(1, config.webhooks?.retryAttempts ?? 3);

  for (const webhook of webhooks) {
    outcome.attempted++;
    const deliveryId = await recordDelivery(webhook.id, payload, args.screening_reference);

    let attempt = 0;
    let sent = false;
    let lastStatus: number | undefined;
    let lastBody: string | undefined;

    while (attempt < maxAttempts && !sent) {
      attempt++;
      try {
        await validateWebhookUrl(webhook.url);

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'Kabila-Webhooks/1.0',
          'X-Kabila-Event': args.event,
          'X-Kabila-Delivery': deliveryId ?? 'unrecorded',
          'X-Kabila-Attempt': String(attempt),
        };

        const rawSecret = webhook.secret_key || webhook.secret_token;
        if (rawSecret) {
          const signingSecret = decryptWebhookSecret(rawSecret);
          if (signingSecret) {
            const body = JSON.stringify(payload);
            const signature = `sha256=${require('crypto').createHmac('sha256', signingSecret).update(body, 'utf8').digest('hex')}`;
            headers['X-Kabila-Signature'] = signature;
          }
        }

        const res = await axios.post(webhook.url, payload, {
          headers,
          timeout: config.webhooks?.timeoutMs ?? 10000,
          maxRedirects: 0,
          httpAgent: getSafeHttpAgent(),
          httpsAgent: getSafeHttpsAgent(),
          validateStatus: () => true,
        });

        lastStatus = res.status;
        lastBody = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '');

        if (res.status >= 200 && res.status < 300) {
          sent = true;
          break;
        }
        logger.warn('AML webhook returned non-2xx', {
          webhookId: webhook.id,
          event: args.event,
          status: res.status,
          attempt,
        });
      } catch (err) {
        if (err instanceof SsrfError) {
          lastBody = `Rejected by SSRF guard: ${err.message}`;
          logger.error('AML webhook URL rejected by SSRF guard', {
            webhookId: webhook.id,
            url: webhook.url,
            error: err.message,
          });
          break;
        }
        lastBody = err instanceof Error ? err.message : String(err);
        logger.warn('AML webhook delivery attempt failed', {
          webhookId: webhook.id,
          event: args.event,
          attempt,
          error: lastBody,
        });
      }
    }

    if (sent) outcome.delivered++;
    else outcome.failed++;

    await markDelivery(deliveryId, sent ? 'delivered' : 'failed', attempt, lastStatus, lastBody);
  }

  return outcome;
}

export function fireAmlScreeningCompleted(args: {
  reference: string;
  input_name: string;
  risk_level: string;
  match_found: boolean;
  max_score: number;
}): void {
  void dispatchAmlWebhook({
    event: 'aml.screening.completed',
    screening_reference: args.reference,
    data: {
      input_name: args.input_name,
      risk_level: args.risk_level,
      match_found: args.match_found,
      max_score: args.max_score,
    },
  }).catch((err) => {
    logger.error('aml.screening.completed dispatch failed', {
      reference: args.reference,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

export function fireAmlCaseStatusChanged(args: {
  case_id: string;
  status: string;
  previous_status?: string | null;
}): void {
  if (args.previous_status && args.previous_status === args.status) return;
  void dispatchAmlWebhook({
    event: 'aml.case.status.updated',
    data: {
      case_id: args.case_id,
      status: args.status,
      previous_status: args.previous_status || null,
    },
  }).catch((err) => {
    logger.error('aml.case.status.updated dispatch failed', {
      case_id: args.case_id,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
