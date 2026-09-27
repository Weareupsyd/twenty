import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { catchAsync, ValidationError } from '@/middleware/errorHandler.js';
import { AuthenticationError } from '@/middleware/errorHandler.js';
import { throwOnAuthDatabaseError } from '@/middleware/authDatabase.js';
import { hashHandoffToken } from '@/middleware/auth.js';
import { supabase } from '@/config/database.js';
import { logger } from '@/utils/logger.js';
import config from '@/config/index.js';
import { basicRateLimit } from '@/middleware/rateLimit.js';
import { resolvePublicAssetUrl } from '@/services/storage.js';
import { loadSessionState, mapStatusForResponse } from '@/verification/statusReader.js';
import { FLOW_PRESETS } from '@kabila/shared';
import type { SessionState, VerificationMode } from '@kabila/shared';

const router = express.Router();

// ── Self-healing DDL for public.mobile_handoff_sessions ─────────────────────
// Mirrors migrations/0014_mobile_handoff_sessions.sql. On community/Postgres
// deployments the Kabila boot runner is lenient (MIGRATIONS_LENIENT=true), so
// the table can be missing or stuck in a legacy shape - every QR generation
// then 500s with "Failed to create handoff session". If the insert fails with
// a schema-shaped error we run this guarded DDL once and retry.
const ENSURE_HANDOFF_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS public.mobile_handoff_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token           CHAR(64) NOT NULL UNIQUE,
    api_key_id      UUID NOT NULL,
    user_id         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
    source          TEXT NOT NULL DEFAULT 'api',
    verification_id TEXT,
    result          JSONB,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'mobile_handoff_sessions' AND column_name = 'source') THEN
        ALTER TABLE public.mobile_handoff_sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'api';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'mobile_handoff_sessions' AND column_name = 'verification_id') THEN
        ALTER TABLE public.mobile_handoff_sessions ADD COLUMN verification_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'mobile_handoff_sessions' AND column_name = 'api_key_id') THEN
        DELETE FROM public.mobile_handoff_sessions;
        ALTER TABLE public.mobile_handoff_sessions ADD COLUMN api_key_id UUID NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'mobile_handoff_sessions' AND column_name = 'api_key') THEN
        ALTER TABLE public.mobile_handoff_sessions DROP COLUMN api_key;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS mobile_handoff_sessions_token_idx      ON public.mobile_handoff_sessions (token);
CREATE INDEX IF NOT EXISTS mobile_handoff_sessions_expires_at_idx ON public.mobile_handoff_sessions (expires_at);
CREATE INDEX IF NOT EXISTS mobile_handoff_sessions_api_key_id_idx ON public.mobile_handoff_sessions (api_key_id);
`;

let handoffTableEnsured = false;

/** Detects "relation/column does not exist"-shaped Postgres errors. */
function isSchemaError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === '42703') return true;
  const msg = (error.message || '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('schema cache');
}

/** Attempt to (re)create mobile_handoff_sessions in-process. Community-mode only -
 *  on Supabase cloud the exec_sql RPC is unavailable and this quietly no-ops. */
async function ensureHandoffTable(): Promise<boolean> {
  if (handoffTableEnsured) return false;
  try {
    const { error } = await supabase.rpc('exec_sql', { sql: ENSURE_HANDOFF_TABLE_SQL });
    if (error) {
      logger.warn('Handoff table self-heal not applied', { message: error.message });
      return false;
    }
    handoffTableEnsured = true;
    logger.info('Self-healed public.mobile_handoff_sessions schema');
    return true;
  } catch (err: any) {
    logger.warn('Handoff table self-heal failed', { message: err?.message });
    return false;
  }
}

// POST /api/verify/handoff/create - desktop creates a session, returns token
// Accepts either api_key in body OR X-Session-Token header for session-based auth.
router.post('/create', basicRateLimit, catchAsync(async (req: Request, res: Response) => {
  const { api_key, user_id, source, verification_id } = req.body;
  const sessionToken = req.headers['x-session-token'] as string | undefined;

  // Validate verification_id format if provided (UUID)
  if (verification_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(verification_id)) {
    throw new ValidationError('Invalid verification_id format', 'verification_id', verification_id);
  }

  let resolvedApiKeyId: string;
  let resolvedUserId: string;

  if (sessionToken) {
    // Session token auth - resolve api_key_id from the verification request
    if (!/^[0-9a-f]{64}$/.test(sessionToken)) {
      throw new AuthenticationError('Invalid session token format');
    }

    const stHash = hashHandoffToken(sessionToken);
    const { data: verification, error: verError } = await supabase
      .from('verification_requests')
      .select('id, developer_id, user_id, session_token_expires_at, session_api_key_id')
      .eq('session_token_hash', stHash)
      .single();

    throwOnAuthDatabaseError(verError);
    if (verError || !verification) {
      throw new AuthenticationError('Invalid session token');
    }
    if (!verification.session_token_expires_at || new Date(verification.session_token_expires_at) < new Date()) {
      throw new AuthenticationError('Session token has expired');
    }

    // Use the exact API key that was used during initialization
    if (!verification.session_api_key_id) {
      throw new AuthenticationError('No API key associated with this session');
    }

    resolvedApiKeyId = verification.session_api_key_id;
    resolvedUserId = user_id || verification.user_id;
  } else {
    // Traditional api_key auth
    if (!api_key || !user_id) {
      throw new ValidationError('api_key and user_id are required', 'body', req.body);
    }

    const keyHash = crypto
      .createHmac('sha256', config.apiKeySecret)
      .update(api_key)
      .digest('hex');

    const { data: apiKeyRecord, error: keyError } = await supabase
      .from('api_keys')
      .select('id, developer_id, is_active, expires_at')
      .eq('key_hash', keyHash)
      .eq('is_active', true)
      .single();

    throwOnAuthDatabaseError(keyError);
    if (keyError || !apiKeyRecord) {
      throw new AuthenticationError('Invalid API key');
    }

    if (apiKeyRecord.expires_at && new Date(apiKeyRecord.expires_at) < new Date()) {
      throw new AuthenticationError('API key has expired');
    }

    resolvedApiKeyId = apiKeyRecord.id;
    resolvedUserId = user_id;
  }

  const validSource = ['api', 'vaas', 'demo'].includes(source) ? source : 'api';
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashHandoffToken(token);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  const sessionRow = {
    token: tokenHash,
    api_key_id: resolvedApiKeyId,
    user_id: resolvedUserId,
    source: validSource,
    expires_at: expiresAt.toISOString(),
    ...(verification_id && { verification_id }),
  };

  let { error } = await supabase
    .from('mobile_handoff_sessions')
    .insert(sessionRow);

  // Self-heal: if the table is missing / in a legacy shape (lenient boot
  // migrations), create it and retry once instead of 500ing forever.
  if (error && isSchemaError(error)) {
    logger.warn('mobile_handoff_sessions schema error - attempting self-heal', {
      code: error.code,
      message: error.message,
    });
    if (await ensureHandoffTable()) {
      ({ error } = await supabase
        .from('mobile_handoff_sessions')
        .insert(sessionRow));
    }
  }

  if (error) {
    logger.error('Failed to create handoff session', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    throw new Error(`Failed to create handoff session: ${error.message}`);
  }

  // Return the raw token - only the hash is stored
  res.status(201).json({ token, expires_at: expiresAt.toISOString() });
}));

// GET /api/verify/handoff/:token/session - mobile fetches session + branding
router.get('/:token/session', catchAsync(async (req: Request, res: Response) => {
  const { token } = req.params;

  if (!/^[0-9a-f]{64}$/.test(token)) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const tokenHash = hashHandoffToken(token);

  // Fetch session (flat query - no nested joins for PgClient compatibility)
  const { data, error } = await supabase
    .from('mobile_handoff_sessions')
    .select('user_id, source, status, expires_at, api_key_id, verification_id')
    .eq('token', tokenHash)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (new Date(data.expires_at) < new Date()) {
    const { error: expireError } = await supabase
      .from('mobile_handoff_sessions')
      .update({ status: 'expired' })
      .eq('token', tokenHash);
    if (expireError) {
      logger.warn('Failed to mark handoff session as expired', { error: expireError });
    }
    return res.status(410).json({ error: 'Session expired' });
  }

  if (data.status !== 'pending') {
    return res.status(409).json({ error: 'Session already used' });
  }

  // Resolve branding + page-builder config via separate lookups (avoids 2-level nested join)
  let branding = null;
  let pageBuilderConfig = null;
  if (data.api_key_id) {
    const { data: apiKey } = await supabase
      .from('api_keys')
      .select('developer_id')
      .eq('id', data.api_key_id)
      .single();

    if (apiKey?.developer_id) {
      const { data: dev } = await supabase
        .from('developers')
        .select('branding_logo_url, branding_accent_color, branding_company_name, company, page_builder_config')
        .eq('id', apiKey.developer_id)
        .single();

      if (dev) {
        branding = {
          logo_url: resolvePublicAssetUrl(dev.branding_logo_url),
          accent_color: dev.branding_accent_color || null,
          company_name: dev.branding_company_name || dev.company || null,
        };
        pageBuilderConfig = (dev as any).page_builder_config || null;
      }
    }
  }

  res.json({
    user_id: data.user_id,
    source: data.source || 'api',
    branding,
    page_builder_config: pageBuilderConfig,
    ...(data.verification_id && { verification_id: data.verification_id }),
  });
}));

// PATCH /api/verify/handoff/:token/link - mobile links verification_id to session
router.patch('/:token/link', catchAsync(async (req: Request, res: Response) => {
  const { token } = req.params;
  const { verification_id } = req.body;

  if (!/^[0-9a-f]{64}$/.test(token)) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!verification_id || typeof verification_id !== 'string') {
    throw new ValidationError('verification_id is required', 'verification_id', verification_id);
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(verification_id)) {
    throw new ValidationError('Invalid verification_id format', 'verification_id', verification_id);
  }

  const tokenHash = hashHandoffToken(token);

  const { data: updated, error } = await supabase
    .from('mobile_handoff_sessions')
    .update({ verification_id })
    .eq('token', tokenHash)
    .eq('status', 'pending')
    .select('id');

  if (error) {
    logger.error('Failed to link verification_id to handoff session', error);
    throw new Error('Failed to link verification_id');
  }

  if (!updated || updated.length === 0) {
    return res.status(404).json({ error: 'Session not found or already completed' });
  }

  res.json({ success: true });
}));

// PATCH /api/verify/handoff/:token/complete - mobile reports completion
router.patch('/:token/complete', catchAsync(async (req: Request, res: Response) => {
  const { token } = req.params;

  if (!/^[0-9a-f]{64}$/.test(token)) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { status, result } = req.body;

  if (!status || !['completed', 'failed'].includes(status)) {
    throw new ValidationError('status must be completed or failed', 'status', status);
  }

  // Validate result shape and size
  if (result != null) {
    if (typeof result !== 'object' || Array.isArray(result)) {
      throw new ValidationError('result must be a plain object', 'result', result);
    }
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 4096) {
      throw new ValidationError('result payload too large (max 4096 bytes)', 'result', result);
    }
  }

  const tokenHash = hashHandoffToken(token);

  // First verify the session exists and hasn't expired
  const { data: session, error: fetchError } = await supabase
    .from('mobile_handoff_sessions')
    .select('status, expires_at')
    .eq('token', tokenHash)
    .single();

  if (fetchError || !session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (new Date(session.expires_at) < new Date()) {
    return res.status(410).json({ error: 'Session expired' });
  }

  // Atomic update - only succeeds if status is still 'pending'
  const { data: updated, error } = await supabase
    .from('mobile_handoff_sessions')
    .update({ status, result: result ?? null })
    .eq('token', tokenHash)
    .eq('status', 'pending')
    .select('id');

  if (error) {
    logger.error('Failed to complete handoff session', error);
    throw new Error('Failed to update session');
  }

  if (!updated || updated.length === 0) {
    return res.status(409).json({ error: 'Session already completed' });
  }

  res.json({ success: true });
}));

// ── Server-side handoff completion fallback helpers ─────────────────────────
// Pure logic extracted for testability: given the linked verification's DB
// status, its session state, and its verification_mode, decide whether the
// verification has reached a terminal state and build the handoff result.

const TERMINAL_DB_STATUSES = ['verified', 'failed', 'manual_review'];

/** Resolve the terminal result of a verification, or null if still in progress. */
export function computeHandoffFinalResult(
  dbStatus: string | null | undefined,
  state: SessionState | null,
  verificationMode?: string | null,
): string | null {
  const status = String(dbStatus || '');
  if (TERMINAL_DB_STATUSES.includes(status)) return status;
  if (!state) return null;
  const mode = (verificationMode as VerificationMode) || 'full';
  const flow = FLOW_PRESETS[mode] ?? FLOW_PRESETS.full;
  return mapStatusForResponse(state, flow).final_result;
}

/** Build the handoff `result` payload - same shape the mobile page PATCHes on /complete. */
export function buildHandoffResult(
  verificationId: string,
  finalResult: string,
  state: SessionState | null,
  externalUserId?: string | null,
) {
  return {
    verification_id: verificationId,
    status: finalResult,
    ...(externalUserId && { user_id: externalUserId }),
    ...(state?.face_match?.similarity_score !== undefined && {
      face_match_score: state.face_match.similarity_score,
    }),
    ...((state as any)?.liveness?.liveness_score !== undefined && {
      liveness_score: (state as any).liveness.liveness_score,
    }),
  };
}

// GET /api/verify/handoff/:token/status - desktop polls for completion
router.get('/:token/status', catchAsync(async (req: Request, res: Response) => {
  const { token } = req.params;

  if (!/^[0-9a-f]{64}$/.test(token)) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const tokenHash = hashHandoffToken(token);

  const { data, error } = await supabase
    .from('mobile_handoff_sessions')
    .select('status, result, expires_at, verification_id')
    .eq('token', tokenHash)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (new Date(data.expires_at) < new Date()) {
    const { error: expireError } = await supabase
      .from('mobile_handoff_sessions')
      .update({ status: 'expired' })
      .eq('token', tokenHash);
    if (expireError) {
      logger.warn('Failed to mark handoff session as expired', { error: expireError });
    }
    return res.status(410).json({ error: 'Session expired' });
  }

  // ── Server-side completion fallback ────────────────────────────────────
  // If the mobile device finished the verification but its PATCH /complete
  // never landed (closed tab, network drop), the session stays 'pending'
  // forever and the desktop never sees a result. The desktop cannot poll
  // GET /api/v2/verify/:id/status itself in the hosted-page flow: its
  // session token is bound to the desktop's own verification, while the
  // handoff created a new one on the phone - that poll is rejected with 400.
  // So resolve the linked verification's terminal state here, where the
  // handoff token itself is the credential.
  if (data.status === 'pending' && data.verification_id) {
    try {
      const { data: vr } = await supabase
        .from('verification_requests')
        .select('status, verification_mode, external_user_id')
        .eq('id', data.verification_id)
        .single();

      if (vr) {
        const state: SessionState | null = await loadSessionState(data.verification_id);
        const finalResult = computeHandoffFinalResult(vr.status, state, vr.verification_mode);

        if (finalResult) {
          const result = buildHandoffResult(
            data.verification_id, finalResult, state, vr.external_user_id,
          );
          const sessionStatus = finalResult === 'failed' ? 'failed' : 'completed';

          // Persist only the 'completed' transition. 'failed' is left for the
          // mobile's own PATCH /complete: marking the row failed from here
          // would immediately invalidate the phone's handoff token (auth
          // rejects 'failed' sessions except /restart) while the phone may
          // still be polling or offering the retry flow. The desktop already
          // receives the terminal response below either way.
          if (sessionStatus === 'completed') {
            const { error: completeError } = await supabase
              .from('mobile_handoff_sessions')
              .update({ status: sessionStatus, result })
              .eq('token', tokenHash)
              .eq('status', 'pending');
            if (completeError) {
              logger.warn('Failed to self-complete handoff session from verification state', {
                verificationId: data.verification_id,
                error: completeError.message,
              });
            }
          }

          logger.info('Handoff session resolved server-side from verification state', {
            verificationId: data.verification_id,
            finalResult,
          });

          return res.json({
            status: sessionStatus,
            verification_id: data.verification_id,
            result,
          });
        }
      }
    } catch (err) {
      // Non-blocking - fall through to the normal pending response
      logger.warn('Handoff completion fallback failed (non-blocking)', {
        verificationId: data.verification_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  res.json({
    status: data.status,
    ...(data.verification_id && { verification_id: data.verification_id }),
    ...(data.status !== 'pending' && { result: data.result }),
  });
}));

export default router;
