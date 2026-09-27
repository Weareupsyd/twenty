import crypto from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { VerificationStatus } from '@kabila/shared';
import { supabase } from '@/config/database.js';
import { hashHandoffToken } from '@/middleware/auth.js';
import { VerificationService } from '@/services/verification.js';
import { saveSessionState } from '@/services/sessionPersistence.js';
import { asRecord, cquery } from './query.js';

export const HOSTED_VERIFICATION_MODES = ['full', 'document_only', 'identity', 'age_only', 'company'] as const;
export type HostedVerificationMode = typeof HOSTED_VERIFICATION_MODES[number];

export type HostedPageConfig = {
  headerTitle: string;
  headerSubtitle: string;
  showPoweredBy: boolean;
  theme: 'dark' | 'light';
  backgroundColor: string;
  cardBackgroundColor: string;
  textColor: string;
  accentColor: string;
  mutedTextColor: string;
  borderColor: string;
  fontFamily: 'dm-sans' | 'inter' | 'system';
  steps: {
    front: { enabled: boolean; label: string };
    back: { enabled: boolean; label: string };
    liveness: { enabled: boolean; label: string };
  };
  completionTitle: string;
  completionMessage: string;
  showConfetti: boolean;
  verificationMode: HostedVerificationMode;
  ageThreshold: number;
};

export const DEFAULT_HOSTED_PAGE_CONFIG: HostedPageConfig = {
  headerTitle: 'Verify Your Identity',
  headerSubtitle: 'Complete the steps below to verify your identity',
  showPoweredBy: true,
  theme: 'dark',
  backgroundColor: '#080c14',
  cardBackgroundColor: '#0f1420',
  textColor: '#dde2ec',
  accentColor: '#00F0FF',
  mutedTextColor: '#8a8a90',
  borderColor: '#1e1e22',
  fontFamily: 'dm-sans',
  steps: {
    front: { enabled: true, label: 'Front of ID' },
    back: { enabled: true, label: 'Back of ID' },
    liveness: { enabled: true, label: 'Live Capture' },
  },
  completionTitle: 'Verification Complete',
  completionMessage: 'Your identity has been successfully verified.',
  showConfetti: false,
  verificationMode: 'full',
  ageThreshold: 18,
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,48}[a-z0-9]$/;

export function normalizeHostedPageConfig(value: unknown): HostedPageConfig {
  const raw = asRecord(value);
  const steps = asRecord(raw.steps);
  const normalizeStep = (name: 'front' | 'back' | 'liveness') => {
    const fallback = DEFAULT_HOSTED_PAGE_CONFIG.steps[name];
    const step = asRecord(steps[name]);
    return {
      enabled: typeof step.enabled === 'boolean' ? step.enabled : fallback.enabled,
      label: typeof step.label === 'string' && step.label.trim()
        ? step.label.trim().slice(0, 80)
        : fallback.label,
    };
  };
  const mode = typeof raw.verificationMode === 'string'
    && (HOSTED_VERIFICATION_MODES as readonly string[]).includes(raw.verificationMode)
    ? raw.verificationMode as HostedVerificationMode
    : DEFAULT_HOSTED_PAGE_CONFIG.verificationMode;
  const age = Number(raw.ageThreshold);
  const text = (key: keyof HostedPageConfig, max: number) => {
    const candidate = raw[key];
    return typeof candidate === 'string' && candidate.trim()
      ? candidate.trim().slice(0, max)
      : String(DEFAULT_HOSTED_PAGE_CONFIG[key]);
  };
  const color = (key: 'backgroundColor' | 'cardBackgroundColor' | 'textColor' | 'accentColor' | 'mutedTextColor' | 'borderColor') => {
    const candidate = raw[key];
    return typeof candidate === 'string' && HEX_RE.test(candidate)
      ? candidate
      : DEFAULT_HOSTED_PAGE_CONFIG[key];
  };

  return {
    headerTitle: text('headerTitle', 200),
    headerSubtitle: text('headerSubtitle', 300),
    showPoweredBy: typeof raw.showPoweredBy === 'boolean' ? raw.showPoweredBy : true,
    theme: raw.theme === 'light' ? 'light' : 'dark',
    backgroundColor: color('backgroundColor'),
    cardBackgroundColor: color('cardBackgroundColor'),
    textColor: color('textColor'),
    accentColor: color('accentColor'),
    mutedTextColor: color('mutedTextColor'),
    borderColor: color('borderColor'),
    fontFamily: raw.fontFamily === 'inter' || raw.fontFamily === 'system' ? raw.fontFamily : 'dm-sans',
    steps: {
      front: normalizeStep('front'),
      back: normalizeStep('back'),
      liveness: normalizeStep('liveness'),
    },
    completionTitle: text('completionTitle', 200),
    completionMessage: text('completionMessage', 500),
    showConfetti: raw.showConfetti === true,
    verificationMode: mode,
    ageThreshold: Number.isInteger(age) && age >= 1 && age <= 99 ? age : 18,
  };
}

export function validateHostedSlug(slug: string | null): string | null {
  if (slug === null || slug === '') return null;
  if (!SLUG_RE.test(slug)) {
    throw Object.assign(new Error('Slug must be 4-50 characters using lowercase letters, numbers, and hyphens'), { status: 422 });
  }
  return slug;
}

type HostedPageRow = QueryResultRow & {
  id: string;
  name: string | null;
  company: string | null;
  email: string;
  status: string | null;
  verification_slug: string | null;
  page_builder_config: unknown;
  branding_logo_url: string | null;
  has_active_key: boolean;
  key_is_sandbox: boolean | null;
};

export async function listHostedPages(): Promise<Array<Record<string, unknown>>> {
  const { rows } = await cquery<HostedPageRow>(
    `SELECT d.id::text, d.name, d.company, d.email, d.status,
            d.verification_slug, d.page_builder_config, d.branding_logo_url,
            EXISTS (
              SELECT 1 FROM public.api_keys k
              WHERE k.developer_id = d.id
                AND k.is_active = TRUE
                AND COALESCE(k.is_service, FALSE) = FALSE
                AND (k.expires_at IS NULL OR k.expires_at > NOW())
            ) AS has_active_key,
            (
              SELECT k.is_sandbox FROM public.api_keys k
              WHERE k.developer_id = d.id
                AND k.is_active = TRUE
                AND COALESCE(k.is_service, FALSE) = FALSE
                AND (k.expires_at IS NULL OR k.expires_at > NOW())
              ORDER BY k.is_sandbox ASC, k.created_at DESC
              LIMIT 1
            ) AS key_is_sandbox
       FROM public.developers d
      WHERE COALESCE(d.status, 'active') <> 'suspended'
        AND (d.email NOT LIKE 'service+%@kabila.app' OR d.email = 'service+hosted-pages@kabila.app')
      ORDER BY COALESCE(NULLIF(d.company, ''), d.name, d.email) ASC`,
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name || row.company || row.email,
    company: row.company,
    email: row.email,
    slug: row.verification_slug,
    logo_url: row.branding_logo_url,
    config: normalizeHostedPageConfig(row.page_builder_config),
    has_active_key: Boolean(row.has_active_key),
    sandbox: row.key_is_sandbox === null ? null : Boolean(row.key_is_sandbox),
  }));
}

export async function saveHostedPage(
  developerId: string,
  value: { slug?: string | null; config: unknown },
): Promise<Record<string, unknown>> {
  const slug = validateHostedSlug(value.slug ?? null);
  const config = normalizeHostedPageConfig(value.config);
  try {
    const { rows } = await cquery<{ id: string; verification_slug: string | null } & QueryResultRow>(
      `UPDATE public.developers
          SET page_builder_config = $2::jsonb,
              verification_slug = $3,
              updated_at = NOW()
        WHERE id = $1::uuid
        RETURNING id::text, verification_slug`,
      [developerId, JSON.stringify(config), slug],
    );
    if (!rows[0]) throw Object.assign(new Error('Hosted page account not found'), { status: 404 });
    return { id: rows[0].id, slug: rows[0].verification_slug, config };
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw Object.assign(new Error('That hosted-page slug is already in use'), { status: 409 });
    }
    throw err;
  }
}

type LaunchAccount = QueryResultRow & {
  developer_id: string;
  slug: string | null;
  page_builder_config: unknown;
  api_key_id: string;
  is_sandbox: boolean;
};

export type HostedSessionInput = {
  developerId: string;
  verificationMode?: HostedVerificationMode;
  ageThreshold?: number;
  issuingCountry?: string;
  applicant?: {
    email?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  };
  /**
   * KYB only. Free text; missing rows mean "inherit deployment defaults" (see
   * migration 64_kyb_workflows.sql). Ignored for person modes.
   */
  workflowId?: string | null;
  /**
   * KYB only. Company details the operator already knows. Stored on the
   * business_sessions row as user_provided_data so the cross-check has
   * something to compare the uploaded documents against.
   */
  company?: Record<string, unknown>;
  /** KYB only. Optional integrator reference for the session. */
  vendorData?: string | null;
  clientIp?: string | null;
  publicOrigin: string;
};

/**
 * Company (KYB) launch path.
 *
 * Kept next to the person-KYC launcher so the same UI ("Live Verification /
 * Start a verification") can drive both. This deliberately does NOT touch
 * public.users / verification_requests - a business session lives in
 * business_sessions and its people are spawned later, on the hosted flow,
 * as their own verification_requests rows linked back via
 * business_key_people.linked_kyc_session_id.
 */
async function createCompanyHostedSession(input: HostedSessionInput): Promise<Record<string, unknown>> {
  // Reuse the same "does this developer have an active API key?" gate as the
  // person path, so the console never launches a session that the API cannot
  // authenticate later.
  const { rows } = await cquery<{ developer_id: string; is_sandbox: boolean }>(
    `SELECT d.id::text AS developer_id, k.is_sandbox
       FROM public.developers d
       JOIN LATERAL (
         SELECT is_sandbox
           FROM public.api_keys
          WHERE developer_id = d.id
            AND is_active = TRUE
            AND COALESCE(is_service, FALSE) = FALSE
            AND (expires_at IS NULL OR expires_at > NOW())
          ORDER BY is_sandbox ASC, created_at DESC
          LIMIT 1
       ) k ON TRUE
      WHERE d.id = $1::uuid
        AND COALESCE(d.status, 'active') <> 'suspended'`,
    [input.developerId],
  );
  const account = rows[0];
  if (!account) {
    throw Object.assign(
      new Error('This hosted page needs an active developer API key before it can launch verifications'),
      { status: 409 },
    );
  }

  // Lazy import breaks a cycle: businessSessionService imports from '@/services/*'
  // which transitively pulls hostedPages back in when the module graph is cold.
  const { createBusinessSession } = await import('@/services/kyb/businessSessionService.js');
  const { session, accessToken } = await createBusinessSession({
    developerId: input.developerId,
    workflowId: input.workflowId ?? null,
    vendorData: input.vendorData ?? null,
    userProvidedData: input.company ?? {},
  });

  const origin = input.publicOrigin.replace(/\/$/, '');
  return {
    verification_id: session.id,
    business_session_id: session.id,
    session_kind: 'business',
    session_number: session.session_number,
    verification_mode: 'company',
    workflow_id: session.workflow_id,
    vendor_data: session.vendor_data,
    verification_url: `${origin}/b/${accessToken}`,
    hosted_url: `${origin}/b/${accessToken}`,
    expires_at: session.access_token_expires_at,
    sandbox: Boolean(account.is_sandbox),
  };
}

export async function createHostedSession(input: HostedSessionInput): Promise<Record<string, unknown>> {
  // Company (KYB) is a different pipeline: no public.users, no
  // verification_requests, no session_token - the token IS the KYB access
  // token and the flow lives at /b/:token. Branch before we touch anything
  // person-shaped.
  if (input.verificationMode === 'company') {
    return createCompanyHostedSession(input);
  }
  const { rows } = await cquery<LaunchAccount>(
    `SELECT d.id::text AS developer_id, d.verification_slug AS slug, d.page_builder_config,
            k.id::text AS api_key_id, k.is_sandbox
       FROM public.developers d
       JOIN LATERAL (
         SELECT id, is_sandbox
           FROM public.api_keys
          WHERE developer_id = d.id
            AND is_active = TRUE
            AND COALESCE(is_service, FALSE) = FALSE
            AND (expires_at IS NULL OR expires_at > NOW())
          ORDER BY is_sandbox ASC, created_at DESC
          LIMIT 1
       ) k ON TRUE
      WHERE d.id = $1::uuid
        AND COALESCE(d.status, 'active') <> 'suspended'`,
    [input.developerId],
  );
  const account = rows[0];
  if (!account) {
    throw Object.assign(new Error('This hosted page needs an active developer API key before it can launch verifications'), { status: 409 });
  }

  const savedConfig = normalizeHostedPageConfig(account.page_builder_config);
  const mode = input.verificationMode || savedConfig.verificationMode;
  if (!(HOSTED_VERIFICATION_MODES as readonly string[]).includes(mode)) {
    throw Object.assign(new Error('Unsupported verification template'), { status: 422 });
  }
  const ageThreshold = mode === 'age_only'
    ? (Number.isInteger(input.ageThreshold) ? Number(input.ageThreshold) : savedConfig.ageThreshold)
    : null;
  if (ageThreshold !== null && (ageThreshold < 1 || ageThreshold > 99)) {
    throw Object.assign(new Error('Age threshold must be between 1 and 99'), { status: 422 });
  }
  const country = (input.issuingCountry || 'UG').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw Object.assign(new Error('Issuing country must be a two-letter ISO code'), { status: 422 });
  }

  const userId = crypto.randomUUID();
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const sessionHash = hashHandoffToken(sessionToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
  const applicant = input.applicant || {};

  // Create the session on the exact same code path as the developer/demo flow
  // (POST /api/v2/verify/initialize): supabase client + VerificationService +
  // saveSessionState. The session is tagged source='api' - never 'demo' - and
  // the applicant is given a one-hour session token whose QR opens the same
  // hosted verification page the demo uses. This replaces the previous raw
  // `INSERT INTO public.users …` path that 500'd with
  // "relation public.users does not exist" on fresh volumes.
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (!existingUser) {
    const { error: userErr } = await supabase.from('users').insert({
      id: userId,
      email: applicant.email || null,
      first_name: applicant.firstName || null,
      last_name: applicant.lastName || null,
      phone: applicant.phone || null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
    if (userErr) {
      throw Object.assign(new Error(`Failed to create verification user: ${userErr.message}`), { status: 500 });
    }
  }

  const verificationService = new VerificationService();
  const record = await verificationService.createVerificationRequest({
    user_id: userId,
    developer_id: account.developer_id,
    is_sandbox: Boolean(account.is_sandbox),
    source: 'api',
  });

  try {
    const { error: updateErr } = await supabase.from('verification_requests').update({
      session_started_at: now.toISOString(),
      verification_mode: mode,
      age_threshold: ageThreshold,
      issuing_country: country,
      client_ip: input.clientIp || null,
      step_timestamps: { init: now.toISOString(), source: 'hosted-page-builder' },
      session_token_hash: sessionHash,
      session_token_expires_at: expiresAt.toISOString(),
      session_api_key_id: account.api_key_id,
    }).eq('id', record.id);
    if (updateErr) {
      throw Object.assign(new Error(`Failed to persist hosted session: ${updateErr.message}`), { status: 500 });
    }

    await saveSessionState(record.id, {
      session_id: record.id,
      current_step: VerificationStatus.AWAITING_FRONT,
      issuing_country: country,
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
  } catch (err) {
    await supabase.from('users').delete().eq('id', userId).then(() => undefined, () => undefined);
    throw err;
  }

  const origin = input.publicOrigin.replace(/\/$/, '');
  const route = account.slug ? `/v/${encodeURIComponent(account.slug)}` : '/user-verification';
  const verificationUrl = `${origin}${route}?session=${sessionToken}`;

  return {
    verification_id: record.id,
    user_id: userId,
    session_token: sessionToken,
    verification_mode: mode,
    ...(ageThreshold !== null ? { age_threshold: ageThreshold } : {}),
    verification_url: verificationUrl,
    expires_at: expiresAt.toISOString(),
    sandbox: Boolean(account.is_sandbox),
  };
}

/** First active developer account that can launch a verification (has a live API key). */
export async function resolveDefaultHostedDeveloperId(): Promise<string> {
  const pages = await listHostedPages();
  const page = pages.find((p) => p.has_active_key);
  if (!page?.id) {
    throw Object.assign(new Error('No verification account with an active API key is configured'), { status: 503 });
  }
  return String(page.id);
}
