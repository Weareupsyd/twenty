/**
 * Business webhook dispatch.
 *
 * `businessWebhook.ts` knows how to *sign* a business event. This module is
 * what actually sends one: it resolves the developer's subscribed endpoints,
 * records a delivery row, signs with X-Signature-V2 and posts.
 *
 * Deliberately separate from `WebhookService.sendWebhook`:
 *   • business events use X-Signature-V2 over the canonicalised payload,
 *     while person events use the legacy X-Kabila-Signature. Overloading one
 *     method with two signature schemes would make it easy to send the wrong
 *     one.
 *   • the delivery row hangs off business_session_id, not
 *     verification_request_id (see migration 62).
 *
 * Delivery is fire-and-forget from the caller's point of view. A webhook
 * endpoint being down must never block a verdict from being recorded.
 */

import axios from 'axios';
import { supabase } from '@/config/database.js';
import config from '@/config/index.js';
import { logger } from '@/utils/logger.js';
import { decryptSecret } from '@kabila/shared';
import { validateWebhookUrl, getSafeHttpAgent, getSafeHttpsAgent, SsrfError } from '@/utils/validateUrl.js';
import { withWebhookSchemaHeal, ensureWebhookOwnerSchema, isWebhookSchemaError } from '@/services/webhookSchema.js';

import {
  signPayload,
  canonicalize,
  buildBusinessPayload,
  SIGNATURE_HEADER,
  type BusinessWebhookEvent,
} from './businessWebhook.js';

interface WebhookRow {
  id: string;
  url: string;
  secret_key?: string | null;
  secret_token?: string | null;
  events?: string[] | null;
  is_active?: boolean;
}

/** Mirrors webhook.ts - tolerate legacy plaintext secrets. */
function decryptWebhookSecret(ciphertext: string): string | null {
  try {
    return decryptSecret(ciphertext, config.encryptionKey);
  } catch {
    return ciphertext;
  }
}

/**
 * Endpoints subscribed to a business event.
 *
 * A webhook with no `events` array is treated as "all events" for person
 * verifications. Business events are deliberately opt-in: an existing
 * integration that predates KYB should not suddenly start receiving business
 * payloads it has no handler for.
 */
export async function getBusinessWebhooks(
  developerId: string,
  eventType: BusinessWebhookEvent,
): Promise<WebhookRow[]> {
  // Same trap as AML dispatch: on a database that never received migration 68
  // the owner_type predicate errors out, the error is swallowed, and every KYB
  // webhook silently stops firing - no delivery, no failure row, nothing to
  // trace. Read, heal, re-read; and only if this process may not alter the
  // schema, drop the owner predicate alone. That is safe here because
  // developer_id remains the tenant filter, and a database without owner_type
  // cannot hold a staff-owned row for it to leak.
  const build = (withOwnerType: boolean) => {
    let query = supabase
      .from('webhooks')
      .select('*')
      .eq('developer_id', developerId)
      .eq('is_active', true);
    if (withOwnerType) query = query.eq('owner_type', 'developer');
    return query;
  };

  let outcome: any = await build(true);
  if (isWebhookSchemaError(outcome?.error)) {
    const repair = await ensureWebhookOwnerSchema({ force: true });
    outcome = await build(true);
    if (isWebhookSchemaError(outcome?.error) && !repair.applied) {
      logger.warn('Falling back to owner_type-less KYB webhook dispatch - AML owner columns unavailable', {
        developerId,
        code: outcome?.error?.code,
      });
      outcome = await build(false);
    }
  }
  const { data, error } = outcome;

  if (error) {
    logger.error('Failed to load business webhooks', { developerId, error: error.message });
    return [];
  }

  return ((data ?? []) as WebhookRow[]).filter(
    (w) => Array.isArray(w.events) && w.events.includes(eventType),
  );
}

async function recordDelivery(
  webhookId: string,
  businessSessionId: string,
  payload: unknown,
): Promise<string | null> {
  const { result } = await withWebhookSchemaHeal(
    () => supabase
      .from('webhook_deliveries')
      .insert({
        webhook_id: webhookId,
        business_session_id: businessSessionId,
        verification_request_id: null,
        payload,
        status: 'pending',
        attempts: 0,
      })
      .select('id')
      .single(),
    { label: 'business-delivery-record' }
  );
  const { data, error } = result as any;

  if (error) {
    logger.error('Failed to record business webhook delivery', { webhookId, error: error.message });
    return null;
  }
  return (data as { id: string }).id;
}

async function markDelivery(
  deliveryId: string | null,
  status: 'delivered' | 'failed',
  attempts: number,
  responseStatus?: number,
  responseBody?: string,
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

export interface DispatchArgs {
  event: BusinessWebhookEvent;
  developerId: string;
  applicationId: string;
  sessionId: string;
  status: string;
  previousStatus?: string | null;
  vendorData?: string | null;
  extra?: Record<string, unknown>;
}

export interface DispatchOutcome {
  attempted: number;
  delivered: number;
  failed: number;
}

/**
 * Send one business event to every subscribed endpoint.
 *
 * Retries follow the same attempt budget as person webhooks. Errors are
 * logged and recorded, never thrown - see the module note.
 */
export async function dispatchBusinessWebhook(args: DispatchArgs): Promise<DispatchOutcome> {
  const outcome: DispatchOutcome = { attempted: 0, delivered: 0, failed: 0 };

  let webhooks: WebhookRow[];
  try {
    webhooks = await getBusinessWebhooks(args.developerId, args.event);
  } catch (err) {
    logger.error('Business webhook lookup failed', {
      sessionId: args.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return outcome;
  }

  if (webhooks.length === 0) return outcome;

  const payload = buildBusinessPayload({
    event: args.event,
    applicationId: args.applicationId,
    sessionId: args.sessionId,
    vendorData: args.vendorData,
    status: args.status,
    previousStatus: args.previousStatus,
    extra: args.extra,
  });

  const maxAttempts = Math.max(1, config.webhooks?.retryAttempts ?? 3);

  for (const webhook of webhooks) {
    outcome.attempted++;
    const deliveryId = await recordDelivery(webhook.id, args.sessionId, payload);

    let attempt = 0;
    let sent = false;
    let lastStatus: number | undefined;
    let lastBody: string | undefined;

    while (attempt < maxAttempts && !sent) {
      attempt++;
      try {
        // Re-validate at delivery time - closes the DNS-rebinding window
        // between webhook registration and now (same posture as webhook.ts).
        await validateWebhookUrl(webhook.url);

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'Kabila-Webhooks/1.0',
          'X-Kabila-Event': args.event,
          'X-Kabila-Delivery': deliveryId ?? 'unrecorded',
          'X-Kabila-Attempt': String(attempt),
        };


        // Send the exact canonical bytes we signed.
        //
        // JSON.stringify(payload) would emit the same DATA but in insertion
        // order, so a receiver following the contract - HMAC the raw body,
        // compare - would compute a different digest and reject a legitimate
        // delivery. Sign and send must be byte-identical.
        const body = canonicalize(payload);

        const rawSecret = webhook.secret_key || webhook.secret_token;
        if (rawSecret) {
          const signingSecret = decryptWebhookSecret(rawSecret);
          if (signingSecret) headers[SIGNATURE_HEADER] = signPayload(payload, signingSecret);
        }

        const res = await axios.post(webhook.url, body, {
          headers,
          timeout: config.webhooks?.timeoutMs ?? 10000,
          maxRedirects: 0,
          httpAgent: getSafeHttpAgent(),
          httpsAgent: getSafeHttpsAgent(),
          validateStatus: () => true,
          transformRequest: [(d) => d],
        });

        lastStatus = res.status;
        lastBody = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '');

        if (res.status >= 200 && res.status < 300) {
          sent = true;
          break;
        }
        logger.warn('Business webhook returned a non-2xx status', {
          webhookId: webhook.id, sessionId: args.sessionId, status: res.status, attempt,
        });
      } catch (err) {
        if (err instanceof SsrfError) {
          // Not retryable - the destination is disallowed and will stay so.
          lastBody = `Rejected by SSRF guard: ${err.message}`;
          logger.error('Business webhook URL rejected by SSRF guard', {
            webhookId: webhook.id, url: webhook.url, error: err.message,
          });
          break;
        }
        lastBody = err instanceof Error ? err.message : String(err);
        logger.warn('Business webhook delivery attempt failed', {
          webhookId: webhook.id, sessionId: args.sessionId, attempt, error: lastBody,
        });
      }
    }

    if (sent) outcome.delivered++;
    else outcome.failed++;

    await markDelivery(deliveryId, sent ? 'delivered' : 'failed', attempt, lastStatus, lastBody);
  }

  return outcome;
}

/**
 * Fire a status-change event, if the status actually changed.
 *
 * Callers can invoke this on every recompute; it is a no-op when the status
 * is unchanged, so integrators don't get a burst of identical APPROVED events
 * every time a document is re-processed.
 */
export function fireBusinessStatusChanged(args: {
  developerId: string;
  applicationId: string;
  sessionId: string;
  status: string;
  previousStatus?: string | null;
  vendorData?: string | null;
  extra?: Record<string, unknown>;
}): void {
  if (args.previousStatus && args.previousStatus === args.status) return;

  void dispatchBusinessWebhook({ event: 'business.status.updated', ...args }).catch((err) => {
    logger.error('business.status.updated dispatch failed', {
      sessionId: args.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/** Fire a data-changed event (documents or key people submitted). */
export function fireBusinessDataUpdated(args: {
  developerId: string;
  applicationId: string;
  sessionId: string;
  status: string;
  vendorData?: string | null;
  extra?: Record<string, unknown>;
}): void {
  void dispatchBusinessWebhook({ event: 'business.data.updated', ...args }).catch((err) => {
    logger.error('business.data.updated dispatch failed', {
      sessionId: args.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
