/**
 * Business session service - the database side of KYB.
 *
 * Everything that needs a decision made lives in the pure modules
 * (roleTags / crossCheck / aggregation). This file loads rows, calls those,
 * and writes the answer back. Keeping the split means the interesting rules
 * stay testable without a database.
 */

import crypto from 'crypto';
import { supabase } from '@/config/database.js';
import { logger } from '@/utils/logger.js';
import { createAMLProviders } from '@/providers/aml/index.js';
import { screenAll } from '@/providers/aml/multiScreen.js';
import { hashHandoffToken } from '@/middleware/auth.js';
import { VerificationService } from '@/services/verification.js';
import { saveSessionState } from '@/services/sessionPersistence.js';
import { VerificationStatus } from '@kabila/shared';
import { emailService } from '@/services/emailService.js';
import { decryptSMSConfig, sendSmsDirect, type SMSProviderConfig } from '@/services/smsService.js';
import { getWhatsAppConfig, sendWhatsAppLink, sendWhatsAppDocument } from '@/services/whatsappService.js';

import {
  normalizeRoleTags,
  personRequiresKyc,
  personRequiresNestedKyb,
  type RolePolicy,
  type RoleTag,
} from './roleTags.js';
import { runCrossCheck, type FieldCheck } from './crossCheck.js';
import {
  resolveOwnershipGraph,
  wouldCreateCycle,
  MAX_NESTING_DEPTH,
  type GraphSession,
  type GraphResolution,
} from './ownershipGraph.js';
import { settingsForSession, deploymentNestedDefault } from './workflowSettings.js';
import { fireBusinessStatusChanged, fireBusinessDataUpdated } from './businessWebhookDispatch.js';
import {
  aggregate,
  toPercent,
  type AggregationOutcome,
  type BusinessStatus,
  type KeyPersonState,
} from './aggregation.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CreateBusinessSessionInput {
  developerId: string;
  workflowId?: string | null;
  vendorData?: string | null;
  /** Company details the integrator already knows, if any. */
  userProvidedData?: Record<string, unknown>;
  /** Nested KYB: position in the ownership tree. */
  parentSessionId?: string | null;
  rootSessionId?: string | null;
  depth?: number;
  spawnedForKeyPersonId?: string | null;
}

export interface KeyPersonInput {
  full_name: string;
  role_tags: string[];
  date_of_birth?: string | null;
  nationality?: string | null;
  email?: string | null;
  phone?: string | null;
  ownership_percentage?: number | null;
  voting_percentage?: number | null;
  is_corporate?: boolean;
  source?: 'registry' | 'document' | 'user_provided';
}

/**
 * Deployment-wide nested KYB default - the *floor* of the layering, not the
 * whole story. A workflow can switch it on or off for itself, and a single
 * call can override both. See workflowSettings.ts.
 *
 * Off unless switched on, because it changes verdicts: a corporate owner that
 * previously sailed through will start holding the parent in review.
 *
 * A getter rather than a const: read at call time so a workflow's setting and
 * the env can be evaluated in the same request, and so tests can change the
 * env without reimporting the module.
 */
export function isNestedKybEnabledByDefault(): boolean {
  return deploymentNestedDefault();
}

export const DEFAULT_REQUIRED_DOCUMENTS = [
  'certificate_of_incorporation',
  'articles_of_association',
  'shareholder_register',
  'proof_of_address',
];

// ── Access tokens ──────────────────────────────────────────────────────────
// Same posture as the person handoff flow: the raw token is returned once and
// only its hash is stored, so a database read can't reconstruct a live link.

export function generateAccessToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashAccessToken(token) };
}

export function hashAccessToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ── Session lifecycle ──────────────────────────────────────────────────────

/**
 * business_sessions.developer_id references developers(id) ON DELETE CASCADE.
 * A stale or fabricated id used to surface as a raw Postgres FK violation
 * (23503), which told the operator nothing about what to fix. Check the
 * account up front and say what is wrong; the insert path below also maps
 * 23503 onto the same error to cover a developer deleted mid-request.
 *
 * Both error surfaces are wired: `status` for the compliance console's
 * sendErr, `statusCode`/`isOperational` for the main errorHandler.
 */
function developerNotFoundError(developerId: string) {
  return Object.assign(
    new Error(
      `Failed to create business session: developer account ${developerId} does not exist in public.developers. ` +
      'Register the developer account (and its API key) first, or pass a developer_id that already exists.',
    ),
    { status: 409, statusCode: 409, isOperational: true, code: 'DEVELOPER_NOT_FOUND' },
  );
}

export async function createBusinessSession(input: CreateBusinessSessionInput) {
  const { token, hash } = generateAccessToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const { data: developer, error: developerError } = await supabase
    .from('developers')
    .select('id')
    .eq('id', input.developerId)
    .maybeSingle();

  if (developerError) {
    throw new Error(`Failed to verify developer account: ${developerError.message}`);
  }
  if (!developer) throw developerNotFoundError(input.developerId);

  const { data, error } = await supabase
    .from('business_sessions')
    .insert({
      developer_id: input.developerId,
      workflow_id: input.workflowId ?? null,
      vendor_data: input.vendorData ?? null,
      status: 'NOT_STARTED',
      user_provided_data: input.userProvidedData ?? {},
      access_token_hash: hash,
      access_token_expires_at: expires.toISOString(),
      parent_session_id: input.parentSessionId ?? null,
      root_session_id: input.rootSessionId ?? null,
      depth: input.depth ?? 0,
      spawned_for_key_person_id: input.spawnedForKeyPersonId ?? null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23503') throw developerNotFoundError(input.developerId);
    throw new Error(`Failed to create business session: ${error.message}`);
  }
  return { session: data, accessToken: token };
}

export async function getBusinessSession(id: string) {
  const { data, error } = await supabase.from('business_sessions').select('*').eq('id', id).single();
  if (error) return null;
  return data;
}

export async function listBusinessSessions(developerId: string, opts: {
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
  /**
   * 'roots' hides sessions spawned to resolve someone else's ownership.
   *
   * Default. A child company is not a customer who applied - listing it beside
   * real applicants inflates the queue and invites an analyst to decide it in
   * isolation, when its whole meaning is the parent it belongs to.
   */
  scope?: 'roots' | 'all';
} = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
  const from = (page - 1) * limit;

  let query = supabase
    .from('business_sessions')
    .select('*', { count: 'exact' })
    .eq('developer_id', developerId)
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  if ((opts.scope ?? 'roots') === 'roots') query = query.is('parent_session_id', null);
  if (opts.status) query = query.eq('status', opts.status.toUpperCase());
  if (opts.search) query = query.ilike('legal_name', `%${opts.search}%`);

  const { data, error, count } = await query;
  if (error) throw new Error(`Failed to list business sessions: ${error.message}`);

  // Tell the caller which rows have subsidiaries, so the list can show it
  // without an N+1 round trip per row.
  const sessions = data ?? [];
  const ids = sessions.map((s: any) => s.id);
  const childCounts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: kids } = await supabase
      .from('business_sessions')
      .select('parent_session_id')
      .in('parent_session_id', ids);
    for (const k of kids ?? []) {
      const pid = (k as any).parent_session_id;
      childCounts.set(pid, (childCounts.get(pid) ?? 0) + 1);
    }
  }

  return {
    sessions: sessions.map((s: any) => ({
      ...s,
      depth: s.depth ?? 0,
      child_session_count: childCounts.get(s.id) ?? 0,
    })),
    total: count ?? 0,
    page,
    limit,
    scope: opts.scope ?? 'roots',
  };
}

async function setStatus(sessionId: string, status: BusinessStatus, reason?: string) {
  const current = await getBusinessSession(sessionId);
  if (!current) return null;
  if (current.status === status && !reason) return current;

  const { data, error } = await supabase
    .from('business_sessions')
    .update({
      status,
      previous_status: current.status,
      decision_reason: reason ?? current.decision_reason,
      updated_at: new Date().toISOString(),
      ...(status === 'APPROVED' || status === 'DECLINED' ? { decided_at: new Date().toISOString() } : {}),
    })
    .eq('id', sessionId)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update business session status', { sessionId, status, error: error.message });
    return current;
  }

  // Notify subscribers. Fire-and-forget: a webhook endpoint being down must
  // never stop a verdict from being recorded. No-ops when nothing changed.
  if (current.status !== status) {
    fireBusinessStatusChanged({
      developerId: current.developer_id,
      applicationId: current.developer_id,
      sessionId,
      status,
      previousStatus: current.status,
      vendorData: current.vendor_data,
      extra: reason ? { decision_reason: reason } : undefined,
    });
  }

  return data;
}

// ── Key people ─────────────────────────────────────────────────────────────

/**
 * Replace the key-people set for a session.
 *
 * Roles arrive as free text from documents or the hosted form, so they're
 * normalised onto the canonical tags here. Anything unmappable is returned to
 * the caller rather than dropped silently - an unrecognised role is a
 * question for an analyst, not something to guess at.
 */
export async function setKeyPeople(
  sessionId: string,
  people: KeyPersonInput[],
  policy: RolePolicy = {},
) {
  const unmappedByPerson: Array<{ name: string; unmapped: string[] }> = [];

  const rows = people.map((p) => {
    const { tags, unmapped } = normalizeRoleTags(p.role_tags ?? []);
    if (unmapped.length) unmappedByPerson.push({ name: p.full_name, unmapped });

    const isCorporate = p.is_corporate === true || personRequiresNestedKyb(tags);
    const requiresKyc = !isCorporate && personRequiresKyc(tags, policy);

    return {
      business_session_id: sessionId,
      full_name: p.full_name,
      date_of_birth: p.date_of_birth ?? null,
      nationality: p.nationality ?? null,
      email: p.email ?? null,
      phone: p.phone ?? null,
      role_tags: tags,
      ownership_percentage: p.ownership_percentage ?? null,
      voting_percentage: p.voting_percentage ?? null,
      is_corporate: isCorporate,
      source: p.source ?? 'user_provided',
      kyc_required: requiresKyc,
    };
  });

  await supabase.from('business_key_people').delete().eq('business_session_id', sessionId);

  const { data, error } = await supabase.from('business_key_people').insert(rows).select();
  if (error) throw new Error(`Failed to save key people: ${error.message}`);

  const session = await getBusinessSession(sessionId);
  if (session) {
    fireBusinessDataUpdated({
      developerId: session.developer_id,
      applicationId: session.developer_id,
      sessionId,
      status: session.status,
      vendorData: session.vendor_data,
      extra: { key_people_count: (data ?? []).length },
    });
  }

  return { keyPeople: data ?? [], unmapped: unmappedByPerson };
}

export async function getKeyPeople(sessionId: string) {
  const { data, error } = await supabase
    .from('business_key_people')
    .select('*')
    .eq('business_session_id', sessionId)
    .order('created_at', { ascending: true });
  // A read failure must not masquerade as "this company has no owners" -
  // that would let an empty result be aggregated into a verdict.
  if (error) throw new Error(`Failed to load key people: ${error.message}`);
  return data ?? [];
}

/**
 * Spawn a child person-KYC session for every role that needs one.
 *
 * The child is an ordinary `verification_requests` row - same orchestrator,
 * same audit trail, same webhooks. KYB does not fork the person pipeline.
 * A person carrying several required tags still gets exactly one child.
 */
export async function spawnLinkedKyc(sessionId: string, developerId: string) {
  const people = await getKeyPeople(sessionId);
  const spawned: Array<{ person_id: string; verification_id: string }> = [];

  for (const person of people) {
    if (!person.kyc_required || person.linked_kyc_session_id || person.is_corporate) continue;

    const { data: vr, error } = await supabase
      .from('verification_requests')
      .insert({
        developer_id: developerId,
        status: 'pending',
        verification_type: 'document',
      })
      .select()
      .single();

    if (error || !vr) {
      logger.error('Failed to spawn linked KYC session', {
        sessionId, person: person.full_name, error: error?.message,
      });
      continue;
    }

    await supabase
      .from('business_key_people')
      .update({
        linked_kyc_session_id: vr.id,
        kyc_status: 'NOT_STARTED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', person.id);

    spawned.push({ person_id: person.id, verification_id: vr.id });
  }

  return spawned;
}

/**
 * Create a proper person verification session for a key person (director/UBO).
 *
 * `spawnLinkedKyc` leaves a bare `verification_requests` row (no session
 * token, no user). This function upgrades that row - or creates a fresh one -
 * into a full session with a session token and verification URL that can be
 * sent to the director for identity verification.
 *
 * Returns the verification_id, session_token, and verification_url, or null
 * if the key person doesn't need KYC or is a corporate owner.
 */
export async function createDirectorVerificationSession(
  keyPersonId: string,
  developerId: string,
  opts?: {
    /** Base URL for the verification link. Defaults to FRONTEND_URL or build a sensible default. */
    publicOrigin?: string;
    /** Email and/or phone to record on the verification request. */
    email?: string | null;
    phone?: string | null;
  },
): Promise<{
  person_id: string;
  verification_id: string;
  session_token: string;
  verification_url: string;
} | null> {
  const { data: person } = await supabase
    .from('business_key_people')
    .select('*')
    .eq('id', keyPersonId)
    .single();

  if (!person || !person.kyc_required || person.is_corporate) return null;

  const sessionToken = crypto.randomBytes(32).toString('hex');
  const sessionHash = hashHandoffToken(sessionToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
  const email = opts?.email || person.email || null;
  const phone = opts?.phone || person.phone || null;

  // Reuse the row spawnLinkedKyc already created, or create a fresh one.
  let verificationId: string | null = person.linked_kyc_session_id ?? null;
  const userId = crypto.randomUUID();

  // Always create a user for the director so the hosted flow has an identity
  // to attach the verification to (spawnLinkedKyc's bare row has no user).
  const { error: userErr } = await supabase.from('users').insert({
    id: userId,
    email,
    first_name: person.full_name?.split(' ').slice(0, -1).join(' ') || person.full_name,
    last_name: person.full_name?.split(' ').slice(-1).join(' ') || '',
    phone,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  });
  if (userErr) {
    logger.error('Failed to create verification user for director', {
      keyPersonId, error: userErr.message,
    });
    return null;
  }

  if (!verificationId) {
    const verificationService = new VerificationService();
    const record = await verificationService.createVerificationRequest({
      user_id: userId,
      developer_id: developerId,
      source: 'api',
    });
    verificationId = record.id;
  }

  // Upgrade the session: attach the user, session token, mode and start timestamp.
  const { error: updateErr } = await supabase.from('verification_requests').update({
    user_id: userId,
    session_started_at: now.toISOString(),
    verification_mode: 'document_only',
    issuing_country: 'UG',
    step_timestamps: { init: now.toISOString(), source: 'kyb' },
    session_token_hash: sessionHash,
    session_token_expires_at: expiresAt.toISOString(),
  }).eq('id', verificationId);
  if (updateErr) {
    logger.error('Failed to update verification session for director', {
      keyPersonId, error: updateErr.message,
    });
    return null;
  }

  // Save session state
  await saveSessionState(verificationId, {
    session_id: verificationId,
    current_step: VerificationStatus.AWAITING_FRONT,
    issuing_country: 'UG',
    rejection_reason: null,
    rejection_detail: null,
    front_extraction: null,
    back_extraction: null,
    cross_validation: null,
    face_match: null,
    liveness: null,
    deepfake_check: null,
    aml_screening: null,
    age_estimation: null,
    velocity_analysis: null,
    geo_analysis: null,
    voice_match: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    completed_at: null,
  } as any);

  // Link back to the key person
  await supabase
    .from('business_key_people')
    .update({
      linked_kyc_session_id: verificationId,
      kyc_status: 'NOT_STARTED',
      email,
      phone,
      updated_at: now.toISOString(),
    })
    .eq('id', keyPersonId);

  // Build verification URL
  const frontendBase = process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || opts?.publicOrigin || '';
  const route = '/user-verification';
  const verificationUrl = frontendBase
    ? `${frontendBase}${route}?session=${sessionToken}`
    : `/user-verification?session=${sessionToken}`;

  return {
    person_id: keyPersonId,
    verification_id: verificationId!,
    session_token: sessionToken,
    verification_url: verificationUrl,
  };
}

/**
 * Prepare verification sessions for all key people (directors/UBOs) who need KYC.
 *
 * Creates proper verification sessions with URLs for each, linking them back
 * to the business_key_people rows. Returns array of created sessions.
 */
export async function prepareDirectorVerifications(
  sessionId: string,
  developerId: string,
  opts?: {
    publicOrigin?: string;
    /** Contacts keyed by key_person_id { email?: string; phone?: string } */
    contacts?: Record<string, { email?: string | null; phone?: string | null }>;
  },
): Promise<Array<{
  person_id: string;
  full_name: string;
  verification_id: string;
  session_token: string;
  verification_url: string;
  email?: string | null;
  phone?: string | null;
}>> {
  const people = await getKeyPeople(sessionId);
  const results: Array<{
    person_id: string;
    full_name: string;
    verification_id: string;
    session_token: string;
    verification_url: string;
    email?: string | null;
    phone?: string | null;
  }> = [];

  for (const person of people) {
    if (!person.kyc_required || person.is_corporate) continue;

    // A linked session that already carries a session token is a real
    // verification the director can open - don't create a second one.
    if (person.linked_kyc_session_id) {
      const { data: existing } = await supabase
        .from('verification_requests')
        .select('session_token_hash')
        .eq('id', person.linked_kyc_session_id)
        .single();
      if (existing?.session_token_hash) continue;
    }

    const contact = opts?.contacts?.[person.id];
    const result = await createDirectorVerificationSession(
      person.id,
      developerId,
      {
        publicOrigin: opts?.publicOrigin,
        email: contact?.email || person.email,
        phone: contact?.phone || person.phone,
      },
    );
    if (result) {
      results.push({
        ...result,
        full_name: person.full_name,
        email: contact?.email || person.email,
        phone: contact?.phone || person.phone,
      });
    }
  }

  return results;
}

/**
 * Send verification links to directors via email and/or WhatsApp/SMS.
 *
 * Uses the developer's configured email and SMS providers. Returns the
 * delivery status per director.
 */
export async function sendVerificationLinks(
  sessionId: string,
  developerId: string,
  opts: {
    /** Contacts keyed by key_person_id */
    contacts: Record<string, { email?: string | null; phone?: string | null }>;
    publicOrigin?: string;
  },
): Promise<Array<{
  person_id: string;
  full_name: string;
  email_sent: boolean;
  sms_sent: boolean;
  whatsapp_sent: boolean;
  verification_url: string | null;
  error?: string | null;
}>> {
  // Ensure verification sessions are created first
  const sessions = await prepareDirectorVerifications(sessionId, developerId, {
    publicOrigin: opts.publicOrigin,
    contacts: opts.contacts,
  });

  const results: Array<{
    person_id: string;
    full_name: string;
    email_sent: boolean;
    sms_sent: boolean;
    whatsapp_sent: boolean;
    verification_url: string | null;
    error?: string | null;
  }> = [];

  // Load SMS config if available
  let smsConfig: SMSProviderConfig | null = null;
  try {
    const { data: dev } = await supabase
      .from('developers')
      .select('sms_provider, sms_api_key_encrypted, sms_api_secret_encrypted, sms_phone_number')
      .eq('id', developerId)
      .single();
    if (dev) smsConfig = decryptSMSConfig(dev as any);
  } catch {
    // SMS config not available
  }

  for (const session of sessions) {
    const contact = opts.contacts[session.person_id] || {};
    let emailSent = false;
    let smsSent = false;
    let whatsappSent = false;
    let error: string | null = null;

    // Send email
    if (contact.email && session.verification_url) {
      try {
        emailSent = await emailService.sendEmail({
          to: contact.email,
          subject: 'Complete your identity verification',
          html: `<p>Hi ${session.full_name},</p>
<p>Your identity verification for the company onboarding has been requested.</p>
<p>Please click the link below to complete the verification:</p>
<p><a href="${session.verification_url}" style="display:inline-block;padding:12px 24px;background:#00F0FF;color:#000;text-decoration:none;border-radius:6px;font-weight:600;">Verify Identity</a></p>
<p>Or copy this link into your browser:</p>
<p>${session.verification_url}</p>
<p>This link expires in 1 hour.</p>`,
          text: `Hi ${session.full_name},\n\nYour identity verification for the company onboarding has been requested.\n\nPlease click this link to complete the verification:\n${session.verification_url}\n\nThis link expires in 1 hour.`,
        });
      } catch (err) {
        error = err instanceof Error ? err.message : 'Email send failed';
        logger.warn('Failed to send verification email to director', {
          personId: session.person_id, error,
        });
      }
    }

    // Send SMS via EgoSMS or configured SMS provider
    if (contact.phone && session.verification_url && smsConfig) {
      try {
        const message = `Complete your identity verification: ${session.verification_url} (expires in 1 hour)`;
        smsSent = await sendSmsDirect(smsConfig, contact.phone, message);
      } catch (err) {
        if (!error) error = err instanceof Error ? err.message : 'SMS send failed';
        logger.warn('Failed to send verification SMS to director', {
          personId: session.person_id, error,
        });
      }
    }

    // Send WhatsApp via Evolution API (text + link preview)
    if (contact.phone && session.verification_url) {
      try {
        const waConfig = getWhatsAppConfig();
        const caption = `Hi ${session.full_name}, your identity verification for the company onboarding is ready.`;
        const waResult = await sendWhatsAppLink(waConfig, contact.phone, session.verification_url, caption);
        whatsappSent = waResult.success;
        if (!waResult.success && waResult.error) {
          logger.warn('WhatsApp send failed', { personId: session.person_id, error: waResult.error });
        }
      } catch (err) {
        logger.warn('WhatsApp send error (non-blocking)', {
          personId: session.person_id, error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    results.push({
      person_id: session.person_id,
      full_name: session.full_name,
      email_sent: emailSent,
      sms_sent: smsSent,
      whatsapp_sent: whatsappSent,
      verification_url: session.verification_url,
      error,
    });
  }

  return results;
}

/**
 * Load a whole ownership tree, root first.
 *
 * Bounded by MAX_NESTING_DEPTH so a cycle that slipped past the cycle guard
 * still cannot spin here.
 */
export async function loadOwnershipTree(rootSessionId: string): Promise<GraphSession[]> {
  const out: GraphSession[] = [];
  const seen = new Set<string>();
  let frontier = [rootSessionId];

  for (let depth = 0; depth <= MAX_NESTING_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);

      const session = await getBusinessSession(id);
      if (!session) continue;
      const people = await getKeyPeople(id);

      out.push({
        id: session.id,
        legal_name: session.legal_name,
        status: session.status,
        parent_session_id: session.parent_session_id ?? null,
        depth: session.depth ?? 0,
        people: people.map((p: any) => ({
          id: p.id,
          full_name: p.full_name,
          role_tags: p.role_tags ?? [],
          ownership_percentage: p.ownership_percentage,
          is_corporate: p.is_corporate,
          nested_business_session_id: p.nested_business_session_id,
        })),
      });

      for (const p of people) {
        if (p.nested_business_session_id && !seen.has(p.nested_business_session_id)) {
          next.push(p.nested_business_session_id);
        }
      }
    }
    frontier = next;
  }
  return out;
}

/** Resolve the ownership graph for a root session. */
export async function getOwnershipResolution(rootSessionId: string): Promise<GraphResolution> {
  return resolveOwnershipGraph(rootSessionId, await loadOwnershipTree(rootSessionId));
}

/**
 * Nested KYB - open a child business session for each unresolved corporate
 * owner, so the chain can be walked to natural persons.
 *
 * Refuses to spawn when it would create a cycle (A owns B, B owns A is a real
 * offshore structure) or exceed the depth ceiling. In both cases the corporate
 * owner stays unresolved, which keeps the parent out of APPROVED rather than
 * quietly letting an opaque chain through.
 */
export async function spawnNestedKyb(
  sessionId: string,
  developerId: string,
): Promise<{
  spawned: Array<{ person_id: string; child_session_id: string; access_token: string }>;
  skipped: Array<{ person_id: string; name: string; reason: string }>;
}> {
  const spawned: Array<{ person_id: string; child_session_id: string; access_token: string }> = [];
  const skipped: Array<{ person_id: string; name: string; reason: string }> = [];

  const session = await getBusinessSession(sessionId);
  if (!session) return { spawned, skipped };

  const rootId = session.root_session_id ?? session.id;
  const childDepth = (session.depth ?? 0) + 1;
  const people = await getKeyPeople(sessionId);
  const tree = await loadOwnershipTree(rootId);

  for (const person of people) {
    if (!person.is_corporate || person.nested_business_session_id) continue;

    if (childDepth > MAX_NESTING_DEPTH) {
      const reason = `Ownership chain exceeds ${MAX_NESTING_DEPTH} levels - analyst review required`;
      skipped.push({ person_id: person.id, name: person.full_name, reason });
      // Persisted, not just returned: the analyst who reviews this company
      // later must be able to see why the owner was never resolved.
      await recordNestedFinding(sessionId, person.id, person.full_name, 'MAX_DEPTH_EXCEEDED', reason);
      continue;
    }

    if (wouldCreateCycle(sessionId, person.full_name, tree)) {
      const reason = 'Circular ownership detected - analyst review required';
      skipped.push({ person_id: person.id, name: person.full_name, reason });
      await recordNestedFinding(sessionId, person.id, person.full_name, 'CIRCULAR_OWNERSHIP', reason);
      continue;
    }

    const { session: child, accessToken } = await createBusinessSession({
      developerId,
      workflowId: session.workflow_id,
      vendorData: session.vendor_data ? `${session.vendor_data}:owner:${person.id.slice(0, 8)}` : null,
      userProvidedData: { legal_name: person.full_name },
      parentSessionId: sessionId,
      rootSessionId: rootId,
      depth: childDepth,
      spawnedForKeyPersonId: person.id,
    });

    await supabase
      .from('business_key_people')
      .update({ nested_business_session_id: child.id, updated_at: new Date().toISOString() })
      .eq('id', person.id);

    logger.info('Nested KYB session spawned for corporate owner', {
      parentSessionId: sessionId, childSessionId: child.id, owner: person.full_name, depth: childDepth,
    });

    spawned.push({ person_id: person.id, child_session_id: child.id, access_token: accessToken });
  }

  return { spawned, skipped };
}

/**
 * Persist effective ownership onto each natural person in the tree.
 *
 * FATF thresholds apply to the effective figure - a stake held through a
 * chain - not the direct one, so it is stored rather than recomputed ad hoc
 * by every reader.
 */
export async function persistEffectiveOwnership(rootSessionId: string): Promise<number> {
  const resolution = await getOwnershipResolution(rootSessionId);
  let updated = 0;

  for (const owner of resolution.beneficial_owners) {
    const { error } = await supabase
      .from('business_key_people')
      .update({
        effective_ownership_percentage: owner.effective_percentage,
        ownership_path: owner.path,
        updated_at: new Date().toISOString(),
      })
      .eq('id', owner.person_id);
    if (!error) updated++;
  }
  return updated;
}

/**
 * Record a corporate owner nested KYB declined to resolve.
 *
 * Never throws: a finding that cannot be written must not abort the rest of
 * the spawn pass, or one bad row would stop other owners being resolved.
 */
export async function recordNestedFinding(
  sessionId: string,
  keyPersonId: string | null,
  ownerName: string,
  findingType: 'CIRCULAR_OWNERSHIP' | 'MAX_DEPTH_EXCEEDED',
  detail: string,
): Promise<void> {
  const { error } = await supabase.from('business_nested_findings').insert({
    business_session_id: sessionId,
    key_person_id: keyPersonId,
    owner_name: ownerName,
    finding_type: findingType,
    detail,
  });
  // A duplicate is the expected outcome of re-submitting the same key people;
  // the partial unique index is doing its job, so this is not an error.
  if (error && !/duplicate key|unique constraint/i.test(error.message)) {
    logger.warn('Failed to record nested KYB finding', { sessionId, ownerName, error: error.message });
  }
}

/** Outstanding structural findings for a session. */
export async function getNestedFindings(sessionId: string) {
  const { data, error } = await supabase
    .from('business_nested_findings')
    .select('*')
    .eq('business_session_id', sessionId)
    .is('resolved_at', null)
    .order('created_at', { ascending: true });
  if (error) {
    logger.warn('Failed to load nested KYB findings', { sessionId, error: error.message });
    return [];
  }
  return data ?? [];
}

/** Business sessions spawned by this one to resolve its corporate owners. */
export async function getChildSessions(sessionId: string) {
  const { data, error } = await supabase
    .from('business_sessions')
    .select('*')
    .eq('parent_session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to load child sessions: ${error.message}`);
  return data ?? [];
}

/** A single key person by id, for naming the owner a child was opened for. */
export async function getKeyPersonById(keyPersonId: string) {
  const { data, error } = await supabase
    .from('business_key_people')
    .select('*')
    .eq('id', keyPersonId)
    .single();
  if (error) return null;
  return data;
}

/** Mirror a child's terminal state onto its key-person row. */
export async function syncLinkedKycStatus(verificationRequestId: string, status: string) {
  const { data } = await supabase
    .from('business_key_people')
    .update({ kyc_status: status.toUpperCase(), updated_at: new Date().toISOString() })
    .eq('linked_kyc_session_id', verificationRequestId)
    .select('business_session_id');

  return (data ?? []).map((r: { business_session_id: string }) => r.business_session_id);
}

// ── Documents ──────────────────────────────────────────────────────────────

export async function recordDocument(sessionId: string, doc: {
  document_type: string;
  file_path?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  ocr_data?: Record<string, unknown>;
  ocr_confidence?: number | null;
  fields_expected?: number | null;
  fields_extracted?: number | null;
  tamper_check_passed?: boolean | null;
  tamper_notes?: string | null;
}) {
  const flagged =
    doc.tamper_check_passed === false ||
    (typeof doc.ocr_confidence === 'number' && doc.ocr_confidence < 0.75);

  const { tamper_notes, ...rest } = doc as typeof doc & { tamper_notes?: string | null };

  const { data, error } = await supabase
    .from('business_documents')
    .insert({
      business_session_id: sessionId,
      ...rest,
      tamper_notes: tamper_notes ?? null,
      ocr_data: doc.ocr_data ?? {},
      status: flagged ? 'FLAGGED' : 'PROCESSED',
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to record document: ${error.message}`);
  return data;
}

export async function getDocuments(sessionId: string) {
  const { data, error } = await supabase
    .from('business_documents')
    .select('*')
    .eq('business_session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to load documents: ${error.message}`);
  return data ?? [];
}

// ── Cross-check ────────────────────────────────────────────────────────────

/**
 * Re-run the cross-check and replace the ledger.
 *
 * The company profile columns are filled from whatever the check agreed on -
 * we only promote a value to the session row when at least two sources
 * corroborate it, so an unverified administrator claim never silently
 * becomes the company's official record.
 */
export async function runAndStoreCrossCheck(sessionId: string): Promise<FieldCheck[]> {
  const session = await getBusinessSession(sessionId);
  if (!session) return [];

  const documents = await getDocuments(sessionId);
  const docFields: Record<string, Record<string, string | null | undefined>> = {};
  for (const d of documents) {
    docFields[d.document_type] = (d.ocr_data ?? {}) as Record<string, string | null | undefined>;
  }

  const checks = runCrossCheck({
    documents: docFields,
    userProvided: (session.user_provided_data ?? {}) as Record<string, string | null | undefined>,
    registry: (session.registry_data ?? null) as Record<string, string | null | undefined> | null,
  });

  await supabase.from('business_cross_checks').delete().eq('business_session_id', sessionId);
  if (checks.length) {
    const { error } = await supabase.from('business_cross_checks').insert(
      checks.map((c) => ({
        business_session_id: sessionId,
        field_name: c.field,
        values_by_source: c.values_by_source,
        result: c.result,
        detail: c.detail,
        sources_compared: c.sources_compared,
      })),
    );
    if (error) logger.warn('Failed to persist cross-check ledger', { sessionId, error: error.message });
  }

  const confirmed: Record<string, string> = {};
  for (const c of checks) {
    if (c.result !== 'MATCH') continue;
    const first = Object.values(c.values_by_source).find((v) => v != null);
    if (first) confirmed[c.field] = first;
  }

  if (Object.keys(confirmed).length > 0) {
    await supabase
      .from('business_sessions')
      .update({
        ...(confirmed.legal_name && { legal_name: confirmed.legal_name }),
        ...(confirmed.registration_number && { registration_number: confirmed.registration_number }),
        ...(confirmed.company_type && { company_type: confirmed.company_type }),
        ...(confirmed.incorporation_date && { incorporation_date: confirmed.incorporation_date }),
        ...(confirmed.registered_address && { registered_address: confirmed.registered_address }),
        ...(confirmed.tax_number && { tax_number: confirmed.tax_number }),
        extracted_data: confirmed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId);
  }

  return checks;
}

export async function getCrossChecks(sessionId: string) {
  const { data, error } = await supabase
    .from('business_cross_checks')
    .select('*')
    .eq('business_session_id', sessionId);
  if (error) throw new Error(`Failed to load cross-checks: ${error.message}`);
  return data ?? [];
}

// ── AML ────────────────────────────────────────────────────────────────────

/**
 * Screen the company as an entity and every key person as a person.
 *
 * Reuses the existing AML provider stack rather than introducing a second
 * one, so an operator who has configured OpenSanctions for person KYC gets
 * company screening from the same configuration.
 */
export async function runAmlScreening(sessionId: string) {
  const providers = createAMLProviders();
  if (providers.length === 0) {
    logger.info('AML screening skipped - no providers configured', { sessionId });
    return { entity: null, people: [] };
  }

  const session = await getBusinessSession(sessionId);
  if (!session) return { entity: null, people: [] };

  await supabase.from('business_aml_screenings').delete().eq('business_session_id', sessionId);

  let entityResult = null;
  const entityName = session.legal_name || (session.user_provided_data as any)?.legal_name;
  if (entityName) {
    entityResult = await screenAll(providers, { full_name: entityName });
    await supabase.from('business_aml_screenings').insert({
      business_session_id: sessionId,
      key_person_id: null,
      subject_type: 'entity',
      screened_name: entityName,
      risk_level: entityResult.risk_level,
      match_found: entityResult.match_found,
      matches: entityResult.matches,
      lists_checked: entityResult.lists_checked,
      screened_at: entityResult.screened_at,
    });
  }

  const people = await getKeyPeople(sessionId);
  const personResults: Array<{ person_id: string; risk_level: string }> = [];

  for (const person of people) {
    const result = await screenAll(providers, {
      full_name: person.full_name,
      date_of_birth: person.date_of_birth,
      nationality: person.nationality,
    });

    await supabase.from('business_aml_screenings').insert({
      business_session_id: sessionId,
      key_person_id: person.id,
      subject_type: 'person',
      screened_name: person.full_name,
      risk_level: result.risk_level,
      match_found: result.match_found,
      matches: result.matches,
      lists_checked: result.lists_checked,
      screened_at: result.screened_at,
    });

    personResults.push({ person_id: person.id, risk_level: result.risk_level });
  }

  // Phase 4 dual-write: copy KYB screens into aml.screening_requests + ubo_links.
  void import('@/compliance/dualWrite.js').then(async (m) => {
    const rows = await getAmlScreenings(sessionId);
    for (const r of rows as any[]) {
      await m.mirrorKybScreening({
        id: r.id,
        business_session_id: sessionId,
        key_person_id: r.key_person_id,
        subject_type: r.subject_type,
        screened_name: r.screened_name,
        risk_level: r.risk_level,
        match_found: r.match_found,
        matches: r.matches,
        screened_at: r.screened_at,
      });
    }
  }).catch((err) => logger.warn('Phase 4 KYB dual-write skipped', { sessionId, err }));

  return { entity: entityResult, people: personResults };
}

export async function getAmlScreenings(sessionId: string) {
  const { data, error } = await supabase
    .from('business_aml_screenings')
    .select('*')
    .eq('business_session_id', sessionId);
  if (error) throw new Error(`Failed to load AML screenings: ${error.message}`);
  return data ?? [];
}

// ── Aggregation ────────────────────────────────────────────────────────────

/**
 * Recompute the verdict from current state and persist it.
 * Safe to call repeatedly - it is the single place the status is decided.
 */
export async function recomputeVerdict(
  sessionId: string,
  opts: {
    policy?: RolePolicy;
    requiredDocuments?: string[];
    autoApprove?: boolean;
    /**
     * Force nested ownership resolution on or off for this call, ignoring the
     * workflow's setting. Leave undefined to use the workflow (then the
     * deployment default).
     */
    resolveNestedOwnership?: boolean;
  } = {},
): Promise<AggregationOutcome | null> {
  const session = await getBusinessSession(sessionId);
  if (!session) return null;

  const [people, documents, crossChecks, aml] = await Promise.all([
    getKeyPeople(sessionId),
    getDocuments(sessionId),
    getCrossChecks(sessionId),
    getAmlScreenings(sessionId),
  ]);

  const entityAml = aml.find((a: any) => a.subject_type === 'entity');
  const amlByPerson = new Map<string, string>(
    aml.filter((a: any) => a.key_person_id).map((a: any) => [a.key_person_id, a.risk_level]),
  );

  const keyPeople: KeyPersonState[] = people.map((p: any) => ({
    id: p.id,
    full_name: p.full_name,
    role_tags: (p.role_tags ?? []) as RoleTag[],
    ownership_percentage: p.ownership_percentage,
    is_corporate: p.is_corporate,
    kyc_status: p.kyc_status,
    aml_risk_level: (amlByPerson.get(p.id) as any) ?? null,
  }));

  // call override > workflow setting > deployment default
  const settings = await settingsForSession(session, opts);

  // Only walk the ownership tree when nested KYB is on - it is several extra
  // queries, and a workflow that doesn't use it shouldn't pay for it.
  const nested = settings.nestedOwnershipEnabled;
  let graph = null;
  if (nested) {
    const rootId = session.root_session_id ?? session.id;
    graph = await getOwnershipResolution(rootId);
  }

  const outcome = aggregate({
    keyPeople,
    documents: documents.map((d: any) => ({
      document_type: d.document_type,
      status: d.status,
      tamper_check_passed: d.tamper_check_passed,
    })),
    requiredDocumentTypes: settings.requiredDocuments ?? DEFAULT_REQUIRED_DOCUMENTS,
    crossCheckResults: crossChecks.map((c: any) => c.result),
    entityAmlRisk: (entityAml?.risk_level as any) ?? null,
    policy: opts.policy,
    ownershipGraph: graph,
    options: {
      ...(settings.autoApproveWhenClean === undefined
        ? {}
        : { autoApproveWhenClean: settings.autoApproveWhenClean }),
      resolveNestedOwnership: nested,
    },
  });

  await setStatus(
    sessionId,
    outcome.status,
    outcome.reasons.map((r) => `${r.code}: ${r.detail}`).join(' | '),
  );

  return outcome;
}

/** Analyst decision from the review surface. */
export async function recordDecision(
  sessionId: string,
  decision: 'APPROVED' | 'DECLINED' | 'IN_REVIEW',
  reviewerId: string,
  note?: string,
) {
  const { data, error } = await supabase
    .from('business_sessions')
    .update({
      status: decision,
      decision_reason: note ?? null,
      decided_at: new Date().toISOString(),
      decided_by: reviewerId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .select()
    .single();

  if (error) throw new Error(`Failed to record decision: ${error.message}`);

  fireBusinessStatusChanged({
    developerId: data.developer_id,
    applicationId: data.developer_id,
    sessionId,
    status: decision,
    previousStatus: data.previous_status,
    vendorData: data.vendor_data,
    extra: { decided_by: reviewerId, ...(note ? { note } : {}) },
  });

  return data;
}

// ── Decision object ────────────────────────────────────────────────────────

/**
 * Assemble the public decision payload.
 * Shape mirrors the documented contract so integrators can consume it as-is.
 */
export async function buildDecisionObject(sessionId: string) {
  const session = await getBusinessSession(sessionId);
  if (!session) return null;

  const [people, documents, crossChecks, aml] = await Promise.all([
    getKeyPeople(sessionId),
    getDocuments(sessionId),
    getCrossChecks(sessionId),
    getAmlScreenings(sessionId),
  ]);

  const amlByPerson = new Map<string, any>(
    aml.filter((a: any) => a.key_person_id).map((a: any) => [a.key_person_id, a]),
  );

  const outcome = aggregate({
    keyPeople: people.map((p: any) => ({
      id: p.id,
      full_name: p.full_name,
      role_tags: (p.role_tags ?? []) as RoleTag[],
      ownership_percentage: p.ownership_percentage,
      is_corporate: p.is_corporate,
      kyc_status: p.kyc_status,
      aml_risk_level: amlByPerson.get(p.id)?.risk_level ?? null,
    })),
    documents: documents.map((d: any) => ({
      document_type: d.document_type,
      status: d.status,
      tamper_check_passed: d.tamper_check_passed,
    })),
    requiredDocumentTypes: DEFAULT_REQUIRED_DOCUMENTS,
    crossCheckResults: crossChecks.map((c: any) => c.result),
    entityAmlRisk: aml.find((a: any) => a.subject_type === 'entity')?.risk_level ?? null,
  });

  // Where this session sits in the ownership tree, and the children it spawned.
  // Without this an analyst reviewing a child has no way back to the parent,
  // and a parent gives no hint that child sessions exist at all.
  const children = await getChildSessions(sessionId);
  const nestedFindings = await getNestedFindings(sessionId);
  const parent = session.parent_session_id ? await getBusinessSession(session.parent_session_id) : null;
  const spawningPerson = session.spawned_for_key_person_id
    ? await getKeyPersonById(session.spawned_for_key_person_id)
    : null;

  return {
    session_id: session.id,
    business_session_id: session.id,
    session_kind: 'business' as const,
    session_number: session.session_number,
    vendor_data: session.vendor_data,
    status: session.status,
    workflow_id: session.workflow_id,

    nesting: {
      depth: session.depth ?? 0,
      root_session_id: session.root_session_id ?? session.id,
      parent: parent
        ? {
            session_id: parent.id,
            legal_name: parent.legal_name,
            status: parent.status,
            // The shareholder in the parent that this session was opened to
            // resolve - the reason this child exists.
            spawned_for: spawningPerson
              ? { key_person_id: spawningPerson.id, full_name: spawningPerson.full_name,
                  ownership_percentage: toPercent(spawningPerson.ownership_percentage) }
              : null,
          }
        : null,
      // Corporate owners we refused to resolve, and why. Empty is the normal
      // case; a non-empty array is a structural problem an analyst must judge.
      findings: nestedFindings.map((f: any) => ({
        key_person_id: f.key_person_id,
        owner_name: f.owner_name,
        finding_type: f.finding_type,
        detail: f.detail,
        created_at: f.created_at,
      })),
      children: children.map((c: any) => ({
        session_id: c.id,
        legal_name: c.legal_name,
        status: c.status,
        depth: c.depth ?? 0,
        // Which corporate owner this child was opened for.
        for_key_person_id: c.spawned_for_key_person_id,
      })),
    },

    // Registry connector is deferred this release - the array is present and
    // empty rather than absent, so integrators can code against it now.
    registry_checks: session.registry_data ? [session.registry_data] : [],
    registry_status: session.registry_data ? 'CHECKED' : 'DEFERRED',

    company: {
      legal_name: session.legal_name,
      registration_number: session.registration_number,
      company_type: session.company_type,
      incorporation_date: session.incorporation_date,
      jurisdiction: session.jurisdiction,
      registered_address: session.registered_address,
      tax_number: session.tax_number,
      status: session.company_status,
    },

    cross_checks: crossChecks.map((c: any) => ({
      field: c.field_name,
      result: c.result,
      detail: c.detail,
      values_by_source: c.values_by_source,
    })),

    company_aml_checks: aml
      .filter((a: any) => a.subject_type === 'entity')
      .map((a: any) => ({
        screened_name: a.screened_name,
        risk_level: a.risk_level,
        match_found: a.match_found,
        matches: a.matches,
        lists_checked: a.lists_checked,
        screened_at: a.screened_at,
      })),

    key_people_checks: people.map((p: any) => ({
      id: p.id,
      full_name: p.full_name,
      role_tags: p.role_tags,
      ownership_percentage: toPercent(p.ownership_percentage),
      voting_percentage: toPercent(p.voting_percentage),
      is_corporate: p.is_corporate,
      source: p.source,
      linked_kyc_session_id: p.linked_kyc_session_id,
      // Set once nested KYB has opened a child business session for this
      // corporate owner; null means the owner is still unresolved.
      nested_business_session_id: p.nested_business_session_id ?? null,
      effective_ownership_percentage: toPercent(p.effective_ownership_percentage),
      ownership_path: p.ownership_path ?? null,
      kyc_status: p.kyc_status,
      aml: amlByPerson.get(p.id)
        ? {
            risk_level: amlByPerson.get(p.id).risk_level,
            match_found: amlByPerson.get(p.id).match_found,
            matches: amlByPerson.get(p.id).matches,
          }
        : null,
    })),

    ubo_kyc_summary: outcome.ubo_kyc_summary,
    ownership_total: outcome.ownership_total,
    ownership_reconciles: outcome.ownership_reconciles,

    document_verifications: documents.map((d: any) => ({
      document_type: d.document_type,
      status: d.status,
      ocr_data: d.ocr_data,
      ocr_confidence: d.ocr_confidence,
      fields_extracted: d.fields_extracted,
      fields_expected: d.fields_expected,
      tamper_check_passed: d.tamper_check_passed,
    })),

    decision_reasons: outcome.reasons,
    created_at: session.created_at,
    updated_at: session.updated_at,
  };
}
