import axios from 'axios';
import crypto from 'crypto';
import { supabase } from '@/config/database.js';
import config from '@/config/index.js';
import { logger, logWebhookDelivery } from '@/utils/logger.js';
import { Webhook, WebhookDelivery, WebhookPayload } from '@/types/index.js';
import { encryptSecret, decryptSecret } from '@kabila/shared';
import { validateWebhookUrl, getSafeHttpAgent, getSafeHttpsAgent, SsrfError } from '@/utils/validateUrl.js';
import { ensureWebhookOwnerSchema, isWebhookSchemaError, withWebhookSchemaHeal } from '@/services/webhookSchema.js';

/**
 * Build the headers attached to every webhook delivery. Pure function -
 * exported so unit tests can assert header construction without spinning
 * up axios / supabase mocks.
 *
 * Includes X-Kabila-Sandbox (boolean string) and X-Kabila-Verification-Mode
 * ("sandbox" | "production") - receivers can route or alert based on these
 * without parsing the JSON payload.
 */
export function buildWebhookHeaders(
  webhook: Pick<Webhook, 'is_sandbox'>,
  deliveryId: string,
  attempt: number,
  payload?: Pick<WebhookPayload, 'is_service' | 'service_product' | 'service_environment' | 'event_id'>,
): Record<string, string> {
  const isSandbox = Boolean(webhook.is_sandbox);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Kabila-Webhooks/1.0',
    'X-Kabila-Webhook-Id': deliveryId,
    'X-Kabila-Delivery-Id': deliveryId,
    'X-Kabila-Delivery-Attempt': attempt.toString(),
    'X-Kabila-Sandbox': String(isSandbox),
    'X-Kabila-Verification-Mode': isSandbox ? 'sandbox' : 'production',
  };
  if (payload?.event_id) {
    headers['X-Kabila-Event-Id'] = payload.event_id;
  }

  // Service-key context headers (Phase 2). Emitted only for service-key-driven
  // webhooks so receivers like GatePass can route per-product without parsing
  // JSON. Backwards-compatible - absent for ordinary developer webhooks.
  if (payload?.is_service) {
    headers['X-Kabila-Is-Service'] = 'true';
    if (payload.service_product) {
      headers['X-Kabila-Service-Product'] = payload.service_product;
    }
    if (payload.service_environment) {
      headers['X-Kabila-Service-Environment'] = payload.service_environment;
    }
  }

  return headers;
}

/** Encrypt a webhook secret_token before writing to the DB. */
function encryptWebhookSecret(plaintext: string): string {
  return encryptSecret(plaintext, config.encryptionKey);
}

/** Decrypt a webhook secret_token read from the DB. Returns null on failure. */
function decryptWebhookSecret(ciphertext: string): string | null {
  try {
    return decryptSecret(ciphertext, config.encryptionKey);
  } catch {
    // Backwards-compat: if decryption fails, assume it's a legacy plaintext value
    return ciphertext;
  }
}

export class WebhookService {
  /**
   * Insert a webhook row, repairing the ownership schema first if the write
   * failed for a schema reason.
   *
   * This is the shared entry point for every create path (developer portal,
   * POST /api/webhooks/register, AML staff console), so the self-heal lives
   * here rather than in each route - a database that never received
   * migrations 66/67/68 heals on the first save instead of returning 23503
   * forever. Kuita's webhook store does exactly this: it provisions its own
   * schema at startup rather than trusting the deploy pipeline
   * (kuita-master/cmd/server/webhookstore.go, newWebhookStore).
   */
  async createWebhook(data: {
    developer_id?: string | null;
    compliance_staff_id?: string | null;
    owner_type?: 'developer' | 'staff' | 'system';
    url: string;
    is_sandbox: boolean;
    secret_token?: string;
    events?: string[];
    api_key_id?: string | null;
  }): Promise<Webhook> {
    // Encrypt secret_token before persisting
    const insertData = { ...data };
    if (insertData.secret_token) {
      insertData.secret_token = encryptWebhookSecret(insertData.secret_token);
    }

    const run = () => supabase
      .from('webhooks')
      .insert(insertData)
      .select('*')
      .single();

    const { result, healed } = await withWebhookSchemaHeal(run, { label: 'webhook-service-create' });
    const { data: webhook, error } = result as any;

    if (error) {
      logger.error('Failed to create webhook:', error);
      // FK violation on webhook ownership. `healed` distinguishes the two
      // answers an operator needs: the schema repair ran and the owner id is
      // genuinely absent, versus the repair not being possible from this
      // process (Supabase-managed schema, or a role without DDL).
      if ((error as any).code === '23503') {
        const err = new Error(
          `Webhook owner not found: ${insertData.developer_id ? `developer_id ${insertData.developer_id} does not exist in public.developers` : 'developer_id missing'} ` +
          `(code 23503). ${healed
            ? 'The webhook ownership schema repair ran against this database and the owner row is still missing - ' +
              'create the developer (or use POST /api/compliance/webhooks with compliance_staff_id for a staff-owned AML webhook).'
            : 'Run `npm run db:repair-webhooks` (or `./scripts/repair-webhooks.sh` in the compliance-stack) to ' +
              're-point webhooks_developer_id_fkey at public.developers(id) and add the staff-owned columns from ' +
              'migrations 67_repair_all_developer_fks / 68_add_aml_webhook_owner. ' +
              'For an AML/staff webhook use POST /api/compliance/webhooks or POST /api/aml/webhooks with compliance_staff_id. '} ` +
          `Original: ${(error as any).message}`
        ) as Error & { code?: string; status?: number };
        err.code = '23503';
        err.status = 400;
        throw err;
      }
      if ((error as any).code === '23505') {
        const err = new Error('Webhook already exists for this URL') as Error & { code?: string; status?: number };
        err.code = '23505';
        err.status = 400;
        throw err;
      }
      throw new Error('Failed to create webhook');
    }
    
    return webhook as Webhook;
  }

  async getWebhookById(id: string): Promise<Webhook | null> {
    const { data: webhook, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      logger.error('Failed to get webhook:', error);
      throw new Error('Failed to get webhook');
    }
    
    return webhook as Webhook;
  }
  
  /**
   * Webhooks owned by this developer for a given URL + mode, used as the
   * duplicate guard by POST /api/webhooks/register.
   *
   * The `owner_type = 'developer'` filter keeps staff-owned AML rows out of a
   * developer's namespace. On a database where that column does not exist yet
   * the filter is what fails, and the previous behaviour was a bare 500 for
   * the whole registration flow. Order of operations, cheapest first:
   *   1. query as written;
   *   2. on a schema error, self-heal and retry (this adds the column);
   *   3. if the column is still unavailable (Supabase-managed schema, no DDL
   *      rights), drop only the owner_type predicate. That is safe here because
   *      developer_id equality is still applied - and a database without
   *      owner_type cannot contain staff-owned rows in the first place, so the
   *      widened predicate selects exactly the same set.
   */
  private async findDeveloperWebhook(
    build: (withOwnerType: boolean) => Promise<any>
  ): Promise<any> {
    const first = await build(true);
    if (!isWebhookSchemaError(first?.error)) return first;

    const repair = await ensureWebhookOwnerSchema({ force: true });
    const retry = await build(true);
    if (!isWebhookSchemaError(retry?.error)) return retry;
    if (repair.applied) return retry;   // healed, yet still failing: real error

    const widened = await build(false);
    return widened?.error ? retry : widened;
  }

  async getWebhookByUrl(
    developerId: string, 
    url: string, 
    isSandbox: boolean
  ): Promise<Webhook | null> {
    const { data: webhook, error } = await this.findDeveloperWebhook((withOwnerType) => {
      let query = supabase
        .from('webhooks')
        .select('*')
        .eq('developer_id', developerId)
        .eq('url', url)
        .eq('is_sandbox', isSandbox);
      if (withOwnerType) query = query.eq('owner_type', 'developer');
      return query.single();
    });
    
    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      logger.error('Failed to get webhook by URL:', error);
      throw new Error('Failed to get webhook');
    }
    
    return webhook as Webhook;
  }
  
  async getWebhooksByDeveloper(developerId: string): Promise<Webhook[]> {
    const { data: webhooks, error } = await this.findDeveloperWebhook((withOwnerType) => {
      let query = supabase
        .from('webhooks')
        .select('*')
        .eq('developer_id', developerId)
        .order('created_at', { ascending: false });
      if (withOwnerType) query = query.eq('owner_type', 'developer');
      return query;
    });
    
    if (error) {
      logger.error('Failed to get webhooks by developer:', error);
      throw new Error('Failed to get webhooks');
    }
    
    return (webhooks as Webhook[]) ?? [];
  }

  async updateWebhook(id: string, updates: Partial<Webhook>): Promise<Webhook> {
    // Encrypt secret_token if being updated
    const safeUpdates = { ...updates };
    if (safeUpdates.secret_token) {
      safeUpdates.secret_token = encryptWebhookSecret(safeUpdates.secret_token);
    }

    const { data: webhook, error } = await supabase
      .from('webhooks')
      .update(safeUpdates)
      .eq('id', id)
      .select('*')
      .single();
    
    if (error) {
      logger.error('Failed to update webhook:', error);
      throw new Error('Failed to update webhook');
    }
    
    return webhook as Webhook;
  }
  
  async deleteWebhook(id: string): Promise<void> {
    const { error } = await supabase
      .from('webhooks')
      .delete()
      .eq('id', id);
    
    if (error) {
      logger.error('Failed to delete webhook:', error);
      throw new Error('Failed to delete webhook');
    }
  }
  
  async sendWebhook(
    webhook: Webhook,
    verificationRequestId: string,
    payload: WebhookPayload
  ): Promise<WebhookDelivery> {
    // Normalize the payload once so every delivery attempt re-sends byte-identical
    // JSON: a stable event_id, a created_at, and (below) a delivery_id stamped
    // from the delivery row. Odoo treats event_id / delivery_id as idempotency keys.
    const finalPayload: WebhookPayload = { ...payload };
    if (!finalPayload.event_id) finalPayload.event_id = crypto.randomUUID();
    if (!finalPayload.created_at) finalPayload.created_at = finalPayload.timestamp || new Date().toISOString();

    // Create webhook delivery record
    const { data: delivery, error } = await supabase
      .from('webhook_deliveries')
      .insert({
        webhook_id: webhook.id,
        verification_request_id: verificationRequestId,
        payload: finalPayload,
        status: 'pending',
        attempts: 0
      })
      .select('*')
      .single();
    
    if (error) {
      logger.error('Failed to create webhook delivery:', error);
      throw new Error('Failed to create webhook delivery');
    }

    // Stamp the delivery id onto the persisted payload so retries (which re-read
    // the row in processPendingDeliveries) send the identical JSON including the
    // idempotency key.
    finalPayload.delivery_id = delivery.id;
    await supabase
      .from('webhook_deliveries')
      .update({ payload: finalPayload })
      .eq('id', delivery.id);
    (delivery as WebhookDelivery).payload = finalPayload;
    
    // Send webhook asynchronously
    this.deliverWebhook(delivery as WebhookDelivery, webhook).catch(error => {
      logger.error('Webhook delivery failed:', error);
    });
    
    return delivery as WebhookDelivery;
  }
  
  private async deliverWebhook(delivery: WebhookDelivery, webhook: Webhook): Promise<void> {
    const maxAttempts = config.webhooks.retryAttempts;
    let attempt = delivery.attempts + 1;
    
    while (attempt <= maxAttempts) {
      try {
        logWebhookDelivery(webhook.id, 'attempting', {
          deliveryId: delivery.id,
          attempt,
          maxAttempts,
          url: webhook.url
        });
        
        // Prepare headers (pure construction, exported for testability).
        // Pass the payload so service-key context headers can be emitted
        // when the verification was driven by an isk_* key.
        const headers = buildWebhookHeaders(
          webhook,
          delivery.id,
          attempt,
          delivery.payload as WebhookPayload,
        );

        // Add signature if signing secret is provided (decrypt from DB storage)
        const rawSecret = webhook.secret_key || webhook.secret_token;
        if (rawSecret) {
          const signingSecret = decryptWebhookSecret(rawSecret);
          if (signingSecret) {
            const signature = this.generateSignature(
              JSON.stringify(delivery.payload),
              signingSecret
            );
            headers['X-Kabila-Signature'] = signature;
          }
        }
        
        // Re-validate at delivery time (closes the DNS-rebinding window
        // between webhook creation and now). Safe Agents pin the lookup at
        // connect time as a second layer in case the resolved IP flips
        // between this check and the socket open. maxRedirects: 0 because
        // webhooks should target a fixed endpoint - a 3xx response means
        // the operator's webhook config is broken, not that we should
        // chase the redirect.
        try {
          await validateWebhookUrl(webhook.url);
        } catch (validateErr) {
          if (validateErr instanceof SsrfError) {
            throw new Error(`Webhook URL rejected by SSRF guard: ${validateErr.message}`);
          }
          throw validateErr;
        }

        // Send webhook
        const response = await axios.post(webhook.url, delivery.payload, {
          headers,
          timeout: config.webhooks.timeoutMs,
          maxRedirects: 0,
          httpAgent: getSafeHttpAgent(),
          httpsAgent: getSafeHttpsAgent(),
          validateStatus: (status) => status < 500 // Only retry on 5xx errors
        });
        
        // Update delivery as successful
        await supabase
          .from('webhook_deliveries')
          .update({
            status: 'delivered',
            response_status: response.status,
            response_body: this.truncateResponse(JSON.stringify(response.data)),
            attempts: attempt,
            delivered_at: new Date().toISOString()
          })
          .eq('id', delivery.id);
        
        logWebhookDelivery(webhook.id, 'delivered', {
          deliveryId: delivery.id,
          attempt,
          responseStatus: response.status,
          url: webhook.url
        });
        
        return; // Success, exit retry loop
        
      } catch (error: any) {
        const isLastAttempt = attempt === maxAttempts;
        const responseStatus = error.response?.status || 0;
        const responseBody = error.response ? 
          this.truncateResponse(JSON.stringify(error.response.data)) : 
          error.message;
        
        // Update delivery attempt
        await supabase
          .from('webhook_deliveries')
          .update({
            status: isLastAttempt ? 'failed' : 'pending',
            response_status: responseStatus,
            response_body: responseBody,
            attempts: attempt,
            next_retry_at: isLastAttempt ? null : this.calculateNextRetry(attempt)
          })
          .eq('id', delivery.id);
        
        logWebhookDelivery(webhook.id, isLastAttempt ? 'failed' : 'retry_scheduled', {
          deliveryId: delivery.id,
          attempt,
          maxAttempts,
          error: error.message,
          responseStatus,
          url: webhook.url
        });
        
        if (isLastAttempt) {
          logger.error('Webhook delivery failed after all retries', {
            webhookId: webhook.id,
            deliveryId: delivery.id,
            attempts: attempt,
            error: error.message
          });
          return;
        }
        
        // Wait before retry (exponential backoff)
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000); // Max 30 seconds
        await new Promise(resolve => setTimeout(resolve, delay));
        
        attempt++;
      }
    }
  }
  
  private generateSignature(payload: string, secret: string): string {
    return createWebhookSignature(payload, secret);
  }
  
  private truncateResponse(response: string, maxLength: number = 1000): string {
    if (response.length <= maxLength) {
      return response;
    }
    return response.substring(0, maxLength) + '... (truncated)';
  }
  
  private calculateNextRetry(attempt: number): string {
    // Exponential backoff: 1min, 5min, 15min
    const delays = [60000, 300000, 900000]; // in milliseconds
    const delay = delays[Math.min(attempt - 1, delays.length - 1)];
    const nextRetry = new Date(Date.now() + delay);
    return nextRetry.toISOString();
  }
  
  async getWebhookDeliveries(
    webhookId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{ deliveries: WebhookDelivery[]; total: number }> {
    const offset = (page - 1) * limit;
    
    const { data: deliveries, error } = await supabase
      .from('webhook_deliveries')
      .select('*')
      .eq('webhook_id', webhookId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    const { count, error: countError } = await supabase
      .from('webhook_deliveries')
      .select('*', { count: 'exact', head: true })
      .eq('webhook_id', webhookId);
    
    if (error || countError) {
      logger.error('Failed to get webhook deliveries:', error || countError);
      throw new Error('Failed to get webhook deliveries');
    }
    
    return {
      deliveries: deliveries as WebhookDelivery[],
      total: count || 0
    };
  }
  
  // Process pending webhook deliveries (to be called by a cron job)
  async processPendingDeliveries(): Promise<void> {
    const now = new Date().toISOString();
    
    // Get pending deliveries that are ready for retry
    const { data: pendingDeliveries, error } = await supabase
      .from('webhook_deliveries')
      .select(`
        *,
        webhook:webhooks(*)
      `)
      .eq('status', 'pending')
      .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
      .limit(50); // Process in batches
    
    if (error) {
      logger.error('Failed to get pending webhook deliveries:', error);
      return;
    }
    
    if (!pendingDeliveries || pendingDeliveries.length === 0) {
      return;
    }
    
    logger.info('Processing pending webhook deliveries', {
      count: pendingDeliveries.length
    });
    
    // Process each delivery
    for (const delivery of pendingDeliveries) {
      try {
        await this.deliverWebhook(delivery as WebhookDelivery, delivery.webhook as Webhook);
      } catch (error) {
        logger.error('Error processing webhook delivery:', {
          deliveryId: delivery.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }
  
  /**
   * Fetch all active webhooks for a developer, filtered by sandbox mode
   * and optionally by event type subscription.
   * Returns [] on error - webhook failure must never block verification.
   */
  async getActiveWebhooksForDeveloper(
    developerId: string,
    isSandbox: boolean,
    eventType?: string,
    apiKeyId?: string
  ): Promise<Webhook[]> {
    // Built by a factory because it may run two or three times - the first
    // attempt as written, one after the schema repair, and optionally one with
    // the owner predicate dropped. The query builder accumulates predicates, so
    // each attempt needs a fresh one.
    const buildQuery = (withOwnerType: boolean) => {
      let query = supabase
        .from('webhooks')
        .select('*')
        .eq('developer_id', developerId)
        .eq('is_active', true)
        .eq('is_sandbox', isSandbox);

      // Staff-owned AML webhooks live in the same table; they must never be
      // selected for a developer's verification events.
      if (withOwnerType) {
        query = query.eq('owner_type', 'developer');
      }

      // Each .or() produces an independent parenthesized group ANDed with the rest.
      // When both are present: WHERE ... AND (events filter) AND (api_key filter)
      if (eventType) {
        query = query.or(`events.cs.{${eventType}},events.is.null`);
      }

      // Filter by API key scope: return webhooks that are either unscoped (NULL)
      // or scoped to the specific API key that triggered the verification
      if (apiKeyId) {
        query = query.or(`api_key_id.is.null,api_key_id.eq.${apiKeyId}`);
      }

      return query;
    };

    try {
      // This is the path every verification event takes to find its
      // subscribers, and the place where a missing schema is loudest in
      // silence: owner_type does not exist until migration 68, the read errors,
      // the error is swallowed (correctly - webhook trouble must never block a
      // verification), and the answer becomes "nobody is subscribed". No
      // delivery, no failure row, no log the operator would connect to the
      // broken webhook. So: read, and on a schema error repair and read again.
      let outcome: any = await buildQuery(true);

      if (isWebhookSchemaError(outcome?.error)) {
        const repair = await ensureWebhookOwnerSchema({ force: true });
        outcome = await buildQuery(true);

        if (isWebhookSchemaError(outcome?.error) && !repair.applied) {
          // A database this process may not alter (Supabase-managed schema, or
          // a read-only role) still has to dispatch. The owner_type predicate
          // exists only to exclude staff rows, and a database without that
          // column cannot contain one - so dropping just that predicate selects
          // the same set. developer_id, is_sandbox, events and api_key scoping
          // all stay enforced: this widens nothing.
          logger.warn('Falling back to owner_type-less webhook dispatch - AML owner columns unavailable', {
            developerId,
            code: outcome.error?.code,
            message: outcome.error?.message,
          });
          outcome = await buildQuery(false);
        }
      }

      const { data, error } = outcome;
      if (error) {
        logger.error('Failed to fetch active webhooks for developer:', error);
        return [];
      }

      return (data ?? []) as Webhook[];
    } catch (err) {
      logger.error('Unexpected error fetching active webhooks:', err);
      return [];
    }
  }

  // Get webhook statistics for a developer
  async getWebhookStats(developerId: string): Promise<{
    total_webhooks: number;
    active_webhooks: number;
    total_deliveries: number;
    successful_deliveries: number;
    failed_deliveries: number;
    pending_deliveries: number;
  }> {
    // Get webhook counts
    const { count: totalWebhooks } = await supabase
      .from('webhooks')
      .select('*', { count: 'exact', head: true })
      .eq('developer_id', developerId);
    
    const { count: activeWebhooks } = await supabase
      .from('webhooks')
      .select('*', { count: 'exact', head: true })
      .eq('developer_id', developerId)
      .eq('is_active', true);
    
    // Get delivery stats
    const { data: deliveryStats } = await supabase
      .from('webhook_deliveries')
      .select(`
        status,
        webhook:webhooks!inner(developer_id)
      `)
      .eq('webhook.developer_id', developerId);
    
    const stats = {
      total_webhooks: totalWebhooks || 0,
      active_webhooks: activeWebhooks || 0,
      total_deliveries: deliveryStats?.length || 0,
      successful_deliveries: 0,
      failed_deliveries: 0,
      pending_deliveries: 0
    };
    
    if (deliveryStats) {
      deliveryStats.forEach((delivery: any) => {
        switch (delivery.status) {
          case 'delivered':
            stats.successful_deliveries++;
            break;
          case 'failed':
            stats.failed_deliveries++;
            break;
          case 'pending':
            stats.pending_deliveries++;
            break;
        }
      });
    }
    
    return stats;
  }
}

/**
 * Creates an HMAC-SHA256 signature for a webhook payload.
 * Format: "sha256=<64-char hex digest>"
 */
export function createWebhookSignature(payload: string, secret: string): string {
  return `sha256=${crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex')}`;
}

/**
 * Verifies an HMAC-SHA256 webhook signature using timing-safe comparison
 * to prevent timing-based side-channel attacks.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = createWebhookSignature(payload, secret);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  // Length must match before timingSafeEqual (it requires equal-length buffers)
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}