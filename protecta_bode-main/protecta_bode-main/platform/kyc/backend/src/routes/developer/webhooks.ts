import express, { Request, Response } from 'express';
import { body, param } from 'express-validator';
import { supabase } from '@/config/database.js';
import { authenticateDashboard, scopeForRequest } from '@/middleware/auth.js';
import { catchAsync, ValidationError, NotFoundError, AuthenticationError, APIError } from '@/middleware/errorHandler.js';
import { validate } from '@/middleware/validate.js';
import { logger } from '@/utils/logger.js';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { WEBHOOK_EVENT_NAMES, DEFAULT_WEBHOOK_EVENT_NAMES } from '@/constants/webhookEvents.js';
import { WebhookService, createWebhookSignature } from '@/services/webhook.js';
import {
  ensureWebhookOwnerSchema,
  isWebhookSchemaError,
  withWebhookSchemaHeal,
  type WebhookSchemaRepairResult,
} from '@/services/webhookSchema.js';
import config from '@/config/index.js';
import { decryptSecret } from '@kabila/shared';
import axios from 'axios';
import { validateWebhookUrl, getSafeHttpAgent, getSafeHttpsAgent, SsrfError } from '@/utils/validateUrl.js';

const webhookService = new WebhookService();

// secret_key is plaintext in the current schema; legacy secret_token values
// were encrypted with config.encryptionKey. This mirrors WebhookService's
// delivery logic and therefore returns/signs with the same effective value.
function decryptStoredWebhookSecret(stored: string): string {
  try {
    return decryptSecret(stored, config.encryptionKey);
  } catch {
    return stored;
  }
}

/**
 * Map a Supabase/Postgres error on a webhook read/write to an OPERATIONAL
 * error so the portal receives an actionable 400 instead of a generic 500
 * ("Something went wrong!"). Covers the known live-DB failure classes:
 *   - 23505 unique violation -> duplicate webhook for this URL/scope
 *   - 23503 foreign key     -> developer_id / api_key_id FK miss
 *   - 42501 / RLS           -> insert blocked by row-level security
 *   - 42703 undefined col   -> migrations missing (secret_key / events / api_key_id / owner_type)
 * The full Supabase error (code, message, details, hint) is logged server-side;
 * only message + code go back to the caller.
 *
 * `repair` is the outcome of the in-process webhook schema self-heal (see
 * services/webhookSchema.ts). It is passed in only when a write already failed
 * AFTER that repair ran, which changes what the operator still needs to do:
 * on a community database the heal fixes ownership FKs and the AML owner
 * columns without a migration run, so a surviving error means either the
 * process may not run DDL (privileges / Supabase-managed schema) or the row it
 * references genuinely does not exist.
 */
function supabaseWebhookError(
  action: string,
  error: any,
  repair?: WebhookSchemaRepairResult
): APIError {
  logger.error(`Failed to ${action} webhook (supabase):`, {
    code: error?.code,
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
    selfHeal: repair?.applied === true ? 'applied' : repair?.reason ?? 'not-attempted',
  });

  if (error?.code === '23505') {
    return new APIError('Webhook already exists for this URL', 400, 'WEBHOOK_DUPLICATE');
  }

  if (error?.code === '23503') {
    // Two real-world causes, both repaired by the webhook-ownership schema:
    //   1. A STALE webhooks_developer_id_fkey bound to a legacy `developers`
    //      table OID (created by the original unqualified `REFERENCES
    //      developers(id)`). Authentication resolves the developer in
    //      public.developers, but the INSERT is checked against the stale
    //      table -> SQLSTATE 23503 even though the developer exists.
    //   2. The authenticated principal's developer_id (api_keys.developer_id
    //      or a portal JWT subject) does not exist in public.developers.
    // Migrations 66/67 re-point every developer FK at public.developers(id);
    // migration 68 makes developer_id nullable so staff-owned AML webhooks
    // (compliance_staff_id + owner_type='staff') never write developer_id.
    // The same three repairs now also run IN-PROCESS on boot and on the first
    // schema-shaped webhook write, so a database whose migrations never ran
    // self-heals instead of failing every save.
    const stillBroken =
      repair?.applied === true
        ? 'The in-app webhook schema repair ran and this survived it, so the owner ' +
          `id itself is not present in public.developers (developer_id/api_key_id must ` +
          'reference an existing row) or the table is protected by a policy this role ' +
          'cannot write through.'
        : repair?.reason === 'unsupported'
          ? 'This database is Supabase-managed, so the app did not attempt DDL. ' +
            'Apply the repair with `supabase db push`.'
          : 'The in-app webhook schema repair could not run here (' +
            (repair?.message || 'no DDL privileges via exec_sql') + ').';

    return new APIError(
      `${error?.message || 'Webhook owner not found'} (code ${error.code}). ` +
        `${stillBroken} ` +
        'Repair with `npm run db:repair-webhooks` in backend-node/backend, ' +
        '`./scripts/repair-webhooks.sh` from the compliance-stack (no rebuild needed), or ' +
        '`npm run migrate` (migrations 66_repair_webhook_owner_foreign_keys, ' +
        '67_repair_all_developer_fks and 68_add_aml_webhook_owner re-point ' +
        'webhooks_developer_id_fkey at public.developers(id) and make ' +
        'developer_id nullable for staff-owned AML webhooks).',
      400,
      'WEBHOOK_OWNER_FK'
    );
  }

  const parts = [error?.message || `Failed to ${action} webhook`];
  if (error?.code) parts.push(`(code ${error.code})`);
  if (error?.hint) parts.push(`- hint: ${error.hint}`);
  // A column/table the webhook code depends on is missing. The self-heal
  // provisions it in-process on community databases; report the repair command
  // only when that could not have fixed it, so the guidance stays honest.
  if (['42703', '42P01'].includes(error?.code) && repair?.applied !== true) {
    parts.push(
      'The webhooks schema is behind this build. The in-app webhook self-heal did not run ' +
      `(${repair?.reason === 'unsupported' ? 'Supabase-managed database - apply migrations with supabase db push' : repair?.message || 'no DDL path available'}); ` +
      'run `npm run db:repair-webhooks` in backend-node/backend, or `./scripts/repair-webhooks.sh` ' +
      'from the compliance-stack, then retry.'
    );
  }
  return new APIError(parts.join(' '), 400, error?.code || 'WEBHOOK_DB_ERROR');
}

const router = express.Router();

// Rate limiting for API key operations
const apiKeyRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 50, // limit each IP to 50 API key operations per minute (increased for development)
  message: {
    error: 'Too many API key operations, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Ownership scoping for webhook-management requests uses the shared
// scopeForRequest(req) helper (see @/middleware/auth). It admits three
// principals via authenticateDashboard:
//   - Developer portal JWT -> scope by developer_id only (apiKeyId = null),
//     preserving the original portal behaviour: a developer sees every webhook
//     on their account regardless of which key created it.
//   - Service API key (isk_*) and service-operator session -> scope by
//     developer_id AND api_key_id. Service keys share one shadow developer row
//     per product, so developer_id alone is NOT a tenant boundary; api_key_id
//     is the only thing isolating one key's webhooks from another's. Every
//     read/write below MUST apply this filter.

// List webhooks for the calling principal (developer portal JWT, isk_* service key, or operator session)
router.get('/webhooks',
  apiKeyRateLimit,
  authenticateDashboard,
  catchAsync(async (req: Request, res: Response) => {
    const { developerId, apiKeyId } = scopeForRequest(req);

    let query = supabase
      .from('webhooks')
      .select('id, url, is_sandbox, is_active, created_at, events, secret_key, api_key_id, api_key:api_keys!api_key_id(key_prefix, name)')
      .eq('developer_id', developerId);

    // Service keys only ever see their OWN webhooks (see ownerScope).
    if (apiKeyId) {
      query = query.eq('api_key_id', apiKeyId);
    }

    const { data: webhooks, error } = await query
      .order('created_at', { ascending: false });

    if (error) {
      throw supabaseWebhookError('list', error);
    }

    // Mask secret keys and flatten api_key join
    const masked = (webhooks || []).map((w: any) => ({
      ...w,
      secret_key: w.secret_key
        ? `${w.secret_key.slice(0, 6)}${'*'.repeat(8)}${w.secret_key.slice(-4)}`
        : null,
      api_key_preview: w.api_key ? `${w.api_key.key_prefix}...` : null,
      api_key_name: w.api_key?.name ?? null,
      api_key: undefined,
    }));

    res.json({ webhooks: masked });
  })
);

// Create webhook for the calling principal (developer portal JWT, isk_* service key, or operator session)
router.post('/webhooks',
  apiKeyRateLimit,
  authenticateDashboard,
  [
    body('url')
      .isURL({ protocols: ['https'] })
      .withMessage('Valid HTTPS webhook URL is required'),
    body('is_sandbox')
      .optional()
      .isBoolean()
      .withMessage('is_sandbox must be a boolean'),
    body('events')
      .optional()
      .isArray()
      .withMessage('events must be an array'),
    body('secret')
      .optional()
      .isString()
      .isLength({ min: 16, max: 512 })
      .withMessage('secret must be between 16 and 512 characters'),
    body('api_key_id')
      .optional({ values: 'null' })
      .isUUID()
      .withMessage('api_key_id must be a valid UUID'),
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const developer = req.developer;
    if (!developer) {
      throw new AuthenticationError('Developer authentication required');
    }
    const { developerId, apiKeyId } = scopeForRequest(req);

    const isServicePrincipal = !!req.apiKey?.is_service || !!apiKeyId;
    const { url, is_sandbox = false, events, secret, api_key_id } = req.body;

    // Resolve the effective scope of the webhook being created.
    //   - is_sandbox: service keys force production (they have no sandbox mode;
    //     see checkSandboxMode). A body value is ignored for them.
    //   - api_key_id: for a service key or operator session this is HARD-SET to
    //     the scoped apiKeyId and any body value is ignored. This is security-critical:
    //     service keys share a shadow developer, so honouring a body api_key_id
    //     would let key K1 register a webhook scoped to key K2 and exfiltrate K2's
    //     verification PII. The portal JWT path keeps the original behaviour
    //     (body-supplied, validated below).
    const effectiveSandbox = isServicePrincipal ? false : is_sandbox;
    const scopedApiKeyId: string | null = isServicePrincipal
      ? (apiKeyId || req.apiKey!.id)
      : (api_key_id || null);

    // SSRF protection: block private/reserved network URLs. Awaits DNS
    // resolution so DNS-pinning bypasses (`evil.example A 127.0.0.1`) are
    // caught here, not just at delivery time.
    try {
      await validateWebhookUrl(url);
    } catch (err: any) {
      throw new ValidationError(err.message, 'url', url);
    }

    // For the JWT path, a body-supplied api_key_id must belong to this developer.
    // (Skipped for service keys - scopedApiKeyId is the authenticated key itself.)
    if (!isServicePrincipal && scopedApiKeyId) {
      const { data: ownedKey, error: keyError } = await supabase
        .from('api_keys')
        .select('id')
        .eq('id', scopedApiKeyId)
        .eq('developer_id', developerId)
        .eq('is_active', true)
        .single();

      if (keyError || !ownedKey) {
        throw new ValidationError('API key not found or does not belong to this developer', 'api_key_id', scopedApiKeyId);
      }
    }

    // Validate events are from the allowed set
    if (events && events.length > 0) {
      const invalid = events.filter((e: string) => !WEBHOOK_EVENT_NAMES.includes(e));
      if (invalid.length > 0) {
        throw new ValidationError(`Invalid webhook events: ${invalid.join(', ')}`, 'events', invalid);
      }
    }

    // Check for duplicate: same URL + sandbox mode + API key scope.
    // Uses .limit(1) rather than .single(): .single() turns "multiple rows
    // match" into a PGRST116 error, which previously escaped as a 500. With
    // .limit(1) ANY match - one row or several - is simply a duplicate.
    // Built by a factory because the self-heal below may run it twice: each
    // attempt needs a fresh query builder (chaining .limit() onto a used one
    // would duplicate the clause).
    const runDuplicateProbe = () => {
      let query = supabase
        .from('webhooks')
        .select('id')
        .eq('developer_id', developerId)
        .eq('url', url)
        .eq('is_sandbox', effectiveSandbox);

      if (scopedApiKeyId) {
        query = query.eq('api_key_id', scopedApiKeyId);
      } else {
        query = query.is('api_key_id', null);
      }
      return query.limit(1);
    };

    const { result: dupResult } = await withWebhookSchemaHeal(runDuplicateProbe, {
      label: 'webhook-duplicate-probe',
    });
    const { data: existingRows, error: existingError } = dupResult as any;

    if (existingError) {
      throw supabaseWebhookError('validate', existingError);
    }

    if (existingRows && existingRows.length > 0) {
      throw new ValidationError('Webhook already exists for this URL', 'url', url);
    }

    // Auto-generate signing secret if not provided
    const secretKey = secret || `whsec_${crypto.randomBytes(24).toString('hex')}`;

    const webhookRow = {
      developer_id: developerId,
      url,
      is_sandbox: effectiveSandbox,
      // Defaults to person events only. Business events must be asked for:
      // they carry a different signature header and payload shape, so
      // defaulting them on would break receivers written for person
      // verifications.
      events: events && events.length > 0 ? events : DEFAULT_WEBHOOK_EVENT_NAMES,
      secret_key: secretKey,
      api_key_id: scopedApiKeyId,
      // owner_type is deliberately NOT written here. Migration 68 and the
      // in-process repair both add it as `NOT NULL DEFAULT 'developer'`, so a
      // developer webhook satisfies webhooks_owner_check through the default,
      // while a database that has no such column yet keeps accepting this
      // insert instead of trading its 23503 for a 42703. Staff-owned webhooks
      // (compliance/webhooks.ts) do set it explicitly - they are meaningless
      // without it.
    };

    const runInsert = () => supabase
      .from('webhooks')
      .insert(webhookRow)
      .select('id, url, is_sandbox, is_active, created_at, events, secret_key, api_key_id')
      .single();

    // Self-heal on the failure classes that are a schema lag, not a bad
    // request: a stale webhooks_developer_id_fkey (23503) or a missing
    // owner_type / api_key_id / secret_key column (42703). See
    // @/services/webhookSchema.js - the repair is the one migrations
    // 66/67/68 perform, applied in-process so a database whose boot-time
    // migration never ran fixes itself on the first save instead of failing
    // every save forever.
    const { result: insertResult, healed } = await withWebhookSchemaHeal(runInsert, {
      label: 'webhook-create',
    });
    const { data: webhook, error } = insertResult as any;

    if (error || !webhook) {
      // Operational 400 with the Postgres/Supabase message+code (unique
      // violation, FK miss, RLS denial, missing column…) instead of a 500
      // "Something went wrong!". `healed` records whether the schema repair
      // already had its turn: that is what distinguishes "the owner row really
      // is missing" from "the repair could not run here", and the 400 says so.
      throw supabaseWebhookError(
        'create',
        error ?? new Error('No webhook row returned after insert'),
        healed
          ? { applied: true }
          : isWebhookSchemaError(error)
            ? { applied: false, reason: 'failed', message: (error as any)?.message }
            : undefined
      );
    }

    res.status(201).json({
      webhook: {
        ...webhook,
        secret_key: secretKey, // Return full secret in the creation response
      },
      message: 'Webhook created successfully. Store your signing secret securely.'
    });
  })
);

// Reveal full webhook signing secret (developer portal JWT, isk_* service key, or operator session)
router.get('/webhooks/:webhookId/secret',
  apiKeyRateLimit,
  authenticateDashboard,
  [
    param('webhookId')
      .isUUID()
      .withMessage('Invalid webhook ID format')
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { developerId, apiKeyId } = scopeForRequest(req);

    const { webhookId } = req.params;

    let query = supabase
      .from('webhooks')
      .select('id, secret_key, secret_token')
      .eq('id', webhookId)
      .eq('developer_id', developerId);

    // A service key may only read the secret of its OWN webhook (see ownerScope).
    if (apiKeyId) {
      query = query.eq('api_key_id', apiKeyId);
    }

    const { data: webhook, error } = await query.single();

    if (error || !webhook) {
      throw new NotFoundError('Webhook');
    }

    logger.info('Webhook secret revealed', {
      developerId,
      webhookId,
      viaServiceKey: !!apiKeyId,
    });

    const storedSecret = webhook.secret_key || webhook.secret_token;
    const signingSecret = storedSecret ? decryptStoredWebhookSecret(storedSecret) : null;
    if (!signingSecret) {
      throw new NotFoundError('Webhook signing secret');
    }

    res.json({ secret_key: signingSecret });
  })
);

// Set a caller-chosen signing secret. The legacy encrypted secret_token is
// cleared atomically so it can never silently become the delivery fallback.
router.put('/webhooks/:webhookId/secret',
  apiKeyRateLimit,
  authenticateDashboard,
  [
    param('webhookId').isUUID().withMessage('Invalid webhook ID format'),
    body('secret').isString().isLength({ min: 16, max: 512 })
      .withMessage('secret must be between 16 and 512 characters'),
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { developerId, apiKeyId } = scopeForRequest(req);
    const { webhookId } = req.params;
    const secret = req.body.secret as string;

    let checkQuery = supabase.from('webhooks').select('id')
      .eq('id', webhookId).eq('developer_id', developerId);
    if (apiKeyId) checkQuery = checkQuery.eq('api_key_id', apiKeyId);
    const { data: existing, error: checkError } = await checkQuery.single();
    if (checkError || !existing) throw new NotFoundError('Webhook');

    let updateQuery = supabase.from('webhooks')
      .update({ secret_key: secret, secret_token: null })
      .eq('id', webhookId).eq('developer_id', developerId);
    if (apiKeyId) updateQuery = updateQuery.eq('api_key_id', apiKeyId);
    const { error } = await updateQuery;
    if (error) throw supabaseWebhookError('set secret for', error);

    logger.info('Webhook secret set', { developerId, webhookId, viaServiceKey: !!apiKeyId });
    res.json({ secret_key: secret, message: 'Signing secret updated. Update your receiver before the next delivery.' });
  })
);

// Rotate to a new random signing secret. Like set, this clears secret_token.
router.post('/webhooks/:webhookId/rotate-secret',
  apiKeyRateLimit,
  authenticateDashboard,
  [param('webhookId').isUUID().withMessage('Invalid webhook ID format')],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { developerId, apiKeyId } = scopeForRequest(req);
    const { webhookId } = req.params;
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

    let checkQuery = supabase.from('webhooks').select('id')
      .eq('id', webhookId).eq('developer_id', developerId);
    if (apiKeyId) checkQuery = checkQuery.eq('api_key_id', apiKeyId);
    const { data: existing, error: checkError } = await checkQuery.single();
    if (checkError || !existing) throw new NotFoundError('Webhook');

    let updateQuery = supabase.from('webhooks')
      .update({ secret_key: secret, secret_token: null })
      .eq('id', webhookId).eq('developer_id', developerId);
    if (apiKeyId) updateQuery = updateQuery.eq('api_key_id', apiKeyId);
    const { error } = await updateQuery;
    if (error) throw supabaseWebhookError('rotate secret for', error);

    logger.info('Webhook secret rotated', { developerId, webhookId, viaServiceKey: !!apiKeyId });
    res.json({ secret_key: secret, message: 'Store this secret now and update your receiver.' });
  })
);

// List recent webhook deliveries for a specific webhook
router.get('/webhooks/:webhookId/deliveries',
  apiKeyRateLimit,
  authenticateDashboard,
  [
    param('webhookId')
      .isUUID()
      .withMessage('Invalid webhook ID format')
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { developerId, apiKeyId } = scopeForRequest(req);

    const { webhookId } = req.params;

    // Verify the webhook belongs to the calling principal. Service keys /
    // operators may only see deliveries for their OWN key's webhook.
    let query = supabase
      .from('webhooks')
      .select('id')
      .eq('id', webhookId)
      .eq('developer_id', developerId);
    if (apiKeyId) {
      query = query.eq('api_key_id', apiKeyId);
    }
    const { data: webhook, error: whError } = await query.single();

    if (whError || !webhook) {
      throw new NotFoundError('Webhook');
    }

    const { deliveries, total } = await webhookService.getWebhookDeliveries(webhookId, 1, 25);

    res.json({
      deliveries: deliveries.map(d => ({
        id: d.id,
        event: (d.payload as any)?.event ?? null,
        status: d.status,
        response_status: d.response_status,
        attempts: d.attempts,
        created_at: d.created_at,
        delivered_at: d.delivered_at,
        payload: d.payload ?? null,
        response_body: d.response_body ?? null,
      })),
      total,
    });
  })
);

// Send a test webhook delivery
router.post('/webhooks/:webhookId/test',
  apiKeyRateLimit,
  authenticateDashboard,
  [
    param('webhookId')
      .isUUID()
      .withMessage('Invalid webhook ID format')
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { developerId, apiKeyId } = scopeForRequest(req);

    const { webhookId } = req.params;

    // Service keys / operators may only test their OWN key's webhook.
    let whQuery = supabase
      .from('webhooks')
      .select('*')
      .eq('id', webhookId)
      .eq('developer_id', developerId);
    if (apiKeyId) {
      whQuery = whQuery.eq('api_key_id', apiKeyId);
    }
    const { data: webhook, error: whError } = await whQuery.single();

    if (whError || !webhook) {
      throw new NotFoundError('Webhook');
    }

    const testPayload = {
      user_id: 'test_user_000',
      verification_id: 'test_000',
      status: 'verified' as const,
      timestamp: new Date().toISOString(),
      data: {},
    };

    // Fire directly - no DB record, avoids FK constraint on webhook_deliveries
    try {
      const body = JSON.stringify(testPayload);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Kabila-Webhooks/1.0',
        'X-Kabila-Test': 'true',
      };

      const storedSecret = webhook.secret_key || webhook.secret_token;
      const signingSecret = storedSecret ? decryptStoredWebhookSecret(storedSecret) : null;
      if (signingSecret) {
        headers['X-Kabila-Signature'] = createWebhookSignature(body, signingSecret);
      }

      // Re-validate at test time (closes the DNS-rebinding window since the
      // webhook was registered). SsrfError is a developer-visible reason;
      // anything else gets a generic message so internal IPs/ports
      // surfaced by `err.message` don't become a port-scan oracle.
      // Done BEFORE the abort timer is set up - no timer to clear if this
      // short-circuits.
      try {
        await validateWebhookUrl(webhook.url);
      } catch (validateErr: any) {
        return res.json({
          success: false,
          status_code: null,
          error: validateErr instanceof SsrfError
            ? `Refused to send: ${validateErr.message}`
            : 'Webhook URL validation failed',
        });
      }

      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 8000);

      const response = await axios.post(webhook.url, testPayload, {
        headers,
        timeout: 10000,
        signal: controller.signal,
        maxRedirects: 0,
        httpAgent: getSafeHttpAgent(),
        httpsAgent: getSafeHttpsAgent(),
        validateStatus: () => true,
      });

      clearTimeout(abortTimer);

      res.json({
        success: response.status < 500,
        status_code: response.status,
      });
    } catch (err: any) {
      const isTimeout = err.code === 'ECONNABORTED' || err.code === 'ERR_CANCELED'
        || err.message?.includes('timeout') || err.message?.includes('aborted');
      // Log url+code internally but DON'T echo err.message - it contains
      // ECONNREFUSED <internal-ip>:<port> on failures, which turns this
      // endpoint into a developer-accessible internal port scanner.
      logger.error('Webhook test failed:', { url: webhook.url, code: err.code });
      res.json({
        success: false,
        status_code: null,
        error: isTimeout
          ? 'Connection timed out - verify the webhook URL is reachable'
          : 'Delivery failed - verify the webhook URL is reachable',
      });
    }
  })
);

// Resend a failed/pending webhook delivery with the original payload
router.post('/webhooks/:webhookId/deliveries/:deliveryId/resend',
  apiKeyRateLimit,
  authenticateDashboard,
  [
    param('webhookId').isUUID().withMessage('Invalid webhook ID format'),
    param('deliveryId').isUUID().withMessage('Invalid delivery ID format'),
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { developerId, apiKeyId } = scopeForRequest(req);

    const { webhookId, deliveryId } = req.params;

    // Service keys / operators may only resend deliveries for their OWN key's webhook.
    let whQuery = supabase
      .from('webhooks')
      .select('*')
      .eq('id', webhookId)
      .eq('developer_id', developerId);
    if (apiKeyId) {
      whQuery = whQuery.eq('api_key_id', apiKeyId);
    }
    const { data: webhook, error: whError } = await whQuery.single();

    if (whError || !webhook) {
      throw new NotFoundError('Webhook');
    }

    // Load the original delivery
    const { data: delivery, error: dlError } = await supabase
      .from('webhook_deliveries')
      .select('*')
      .eq('id', deliveryId)
      .eq('webhook_id', webhookId)
      .single();

    if (dlError || !delivery) {
      throw new NotFoundError('Delivery');
    }

    // Create a new delivery with the original payload (preserves audit trail)
    const webhookService = new WebhookService();
    const newDelivery = await webhookService.sendWebhook(
      webhook,
      delivery.verification_request_id,
      delivery.payload,
    );

    logger.info('Webhook delivery resent', {
      developerId,
      webhookId,
      originalDeliveryId: deliveryId,
      newDeliveryId: newDelivery.id,
    });

    res.json({
      success: true,
      delivery: {
        id: newDelivery.id,
        status: newDelivery.status,
        created_at: newDelivery.created_at,
      },
    });
  })
);

// Delete webhook for the calling principal (developer portal JWT, isk_* service key, or operator session)
router.delete('/webhooks/:webhookId',
  apiKeyRateLimit,
  authenticateDashboard,
  [
    param('webhookId')
      .isUUID()
      .withMessage('Invalid webhook ID format')
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { developerId, apiKeyId } = scopeForRequest(req);

    const { webhookId } = req.params;

    // A service key may only delete its OWN webhook (see ownerScope). Apply the
    // api_key_id filter to BOTH the existence check and the delete so the scope
    // can never widen between the two queries.
    let checkQuery = supabase
      .from('webhooks')
      .select('id')
      .eq('id', webhookId)
      .eq('developer_id', developerId);
    if (apiKeyId) {
      checkQuery = checkQuery.eq('api_key_id', apiKeyId);
    }

    const { data: existingWebhook, error: checkError } = await checkQuery.single();

    if (checkError || !existingWebhook) {
      throw new NotFoundError('Webhook');
    }

    let deleteQuery = supabase
      .from('webhooks')
      .delete()
      .eq('id', webhookId)
      .eq('developer_id', developerId);
    if (apiKeyId) {
      deleteQuery = deleteQuery.eq('api_key_id', apiKeyId);
    }

    const { error } = await deleteQuery;

    if (error) {
      throw supabaseWebhookError('delete', error);
    }

    res.json({ message: 'Webhook deleted successfully' });
  })
);

export default router;
