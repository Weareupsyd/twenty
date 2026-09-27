/**
 * Webhook payload enrichment for external KYC/AML integrations (Odoo).
 *
 * Builds the complete, signed webhook payload a downstream system (Odoo) needs
 * to create/update a customer or guarantor record after verification:
 *
 *   - echoes the external correlation metadata unchanged (external_reference,
 *     external_system, subject_type, odoo_* ids);
 *   - a normalized `verification` identity block (names, NIN, DOB, gender,
 *     nationality, phone, address);
 *   - normalized `scores` (document / face-match / liveness / overall);
 *   - a normalized `aml_screening` block Odoo can store directly;
 *   - a secure, time-limited `photos.face_crop_url` with SHA-256 and expiry;
 *   - a `links.verification_url`.
 *
 * All of this is additive: the legacy `data` envelope is still emitted so
 * existing consumers keep working.
 */
import crypto from 'crypto';
import { supabase } from '@/config/database.js';
import { config } from '@/config/index.js';
import { logger } from '@/utils/logger.js';
import type { SessionState } from '@kabila/shared';
import type { NormalizedAmlScreening, WebhookPayload } from '@/types/index.js';

/** Subject types the webhook must support (Section 4 of the Odoo spec). */
export const SUBJECT_TYPES = [
  'customer',
  'guarantor',
  'business_director',
  'beneficial_owner',
  'individual',
] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

/** How long a signed face-crop download URL stays valid (15-60 min requested). */
export const FACE_CROP_TTL_MS = 30 * 60 * 1000;

/** Maximum size of a served face crop (10 MiB). */
export const FACE_CROP_MAX_BYTES = 10 * 1024 * 1024;

/** External correlation columns stored on the verification row. */
export interface CorrelationFields {
  external_reference: string | null;
  external_system: string | null;
  subject_type: string | null;
  odoo_partner_id: string | null;
  odoo_guarantor_id: string | null;
  odoo_lead_id: string | null;
  /** Opaque external subject id (echoed as webhook user_id). */
  external_user_id: string | null;
  /** Internal Kabila user UUID (the users FK). */
  internal_user_id: string | null;
}

export const EMPTY_CORRELATION: CorrelationFields = {
  external_reference: null,
  external_system: null,
  subject_type: null,
  odoo_partner_id: null,
  odoo_guarantor_id: null,
  odoo_lead_id: null,
  external_user_id: null,
  internal_user_id: null,
};

/** First non-empty string of the given candidates, or null. */
export function firstString(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Read the correlation metadata off a verification row. Failure-tolerant: any
 * DB error returns an empty correlation set - the webhook must still fire.
 */
export async function loadCorrelationFields(verificationId: string): Promise<CorrelationFields> {
  try {
    const { data, error } = await supabase
      .from('verification_requests')
      .select('external_reference, external_system, subject_type, odoo_partner_id, odoo_guarantor_id, odoo_lead_id, external_user_id, user_id')
      .eq('id', verificationId)
      .maybeSingle();

    if (error || !data) return { ...EMPTY_CORRELATION };
    return {
      external_reference: (data as any).external_reference ?? null,
      external_system: (data as any).external_system ?? null,
      subject_type: (data as any).subject_type ?? null,
      odoo_partner_id: (data as any).odoo_partner_id ?? null,
      odoo_guarantor_id: (data as any).odoo_guarantor_id ?? null,
      odoo_lead_id: (data as any).odoo_lead_id ?? null,
      external_user_id: (data as any).external_user_id ?? null,
      internal_user_id: (data as any).user_id ?? null,
    };
  } catch (err) {
    logger.warn('loadCorrelationFields failed (non-blocking)', {
      verificationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...EMPTY_CORRELATION };
  }
}

/** Split a full name into first / middle / last components (best-effort). */
export function splitName(fullName: string | null | undefined): {
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
} {
  const name = firstString(fullName);
  if (!name) return { first_name: null, middle_name: null, last_name: null };
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: null, middle_name: null, last_name: null };
  if (parts.length === 1) return { first_name: parts[0], middle_name: null, last_name: null };
  if (parts.length === 2) return { first_name: parts[0], middle_name: null, last_name: parts[1] };
  return {
    first_name: parts[0],
    middle_name: parts.slice(1, -1).join(' '),
    last_name: parts[parts.length - 1],
  };
}

/** Map an OCR document type to a stable national-id-type label. */
export function mapNationalIdType(docType: string | null | undefined, idNumber: string | null | undefined): string | null {
  const t = (docType || '').toLowerCase();
  if (t === 'passport') return 'PASSPORT';
  if (t === 'drivers_license' || t === 'driverslicense') return 'DRIVERS_LICENSE';
  if (idNumber) return 'NIN';
  return t || null;
}

/** Build the normalized `verification` identity block from session state. */
export function buildIdentityBlock(state: SessionState): WebhookPayload['verification'] {
  const front = (state.front_extraction?.ocr ?? {}) as Record<string, any>;
  const back = (state.back_extraction?.qr_payload ?? {}) as Record<string, any>;

  const fullName = firstString(front.full_name, front.name, back.full_name, back.name);
  const { first_name, middle_name, last_name } = splitName(
    fullName || `${firstString(back.first_name)} ${firstString(back.last_name)}`,
  );

  const nationalId = firstString(
    front.id_number, front.document_number, back.id_number, back.document_number,
  );
  const nationality = firstString(front.nationality, back.nationality, front.issuing_country, back.issuing_country);
  const gender = firstString(front.sex, front.gender, back.sex, back.gender);
  const phone = firstString(front.phone, back.phone, back.phone_number, back.mobile);

  const city = firstString(back.city, back.town);
  const district = firstString(back.district, back.sub_county);
  const line1 = firstString(back.address, front.address);

  return {
    full_name: fullName || null,
    first_name: first_name || firstString(back.first_name) || null,
    middle_name: middle_name || null,
    last_name: last_name || firstString(back.last_name) || null,
    national_id: nationalId || null,
    national_id_type: mapNationalIdType(front.detected_document_type, nationalId),
    date_of_birth: firstString(front.date_of_birth, back.date_of_birth) || null,
    gender: gender || null,
    nationality: nationality || null,
    country_of_birth: nationality || null,
    phone: phone || null,
    email: firstString(front.email, back.email) || null,
    address: {
      line_1: line1 || null,
      line_2: null,
      city: city || null,
      district: district || null,
      country: nationality || null,
    },
  };
}

/** Build normalized `scores` (0-1, rounded to 2 dp). */
export function buildScores(state: SessionState): WebhookPayload['scores'] {
  const documentScore = state.front_extraction?.ocr_confidence ?? null;
  const faceMatch = state.face_match?.similarity_score ?? null;
  const liveness = state.liveness?.score ?? null;

  const present = [documentScore, faceMatch, liveness].filter((s): s is number => s != null);
  const overall = present.length > 0
    ? present.reduce((a, b) => a + b, 0) / present.length
    : null;

  const round = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);
  return {
    document_score: round(documentScore),
    face_match_score: round(faceMatch),
    liveness_score: round(liveness),
    overall_score: round(overall),
  };
}

/** Map the compact AML risk level to the normalized Odoo risk_level vocabulary. */
export function mapRiskLevel(compactLevel: string | null | undefined): string {
  const level = (compactLevel || '').toLowerCase();
  if (level === 'confirmed_match' || level === 'critical' || level === 'high') return 'high';
  if (level === 'potential_match' || level === 'medium') return 'medium';
  return 'low';
}

/** Distinguish a sanctions/PEP/adverse-media match by its category. */
function classifyDataset(source: string | null | undefined, matchType: string | null | undefined): string {
  const s = (source || '').toLowerCase();
  const t = (matchType || '').toLowerCase();
  if (t === 'pep' || s.includes('pep')) return 'pep';
  if (s.includes('sanction')) return 'sanctions';
  if (s.includes('media') || t.includes('media')) return 'adverse_media';
  return s || 'sanctions';
}

/**
 * Build the normalized `aml_screening` block Odoo can store directly.
 *
 * Returns null when no screening ran (so Odoo never sees a fabricated "clear").
 * A hit is NEVER normalized to `clear`; `requires_manual_review` is preserved.
 */
export function normalizeAmlScreening(state: SessionState): NormalizedAmlScreening | null {
  const compact = state.aml_screening;
  const unified = state.unified_screening;

  if (!compact && !unified) return null;

  const screeningReference = unified?.reference ?? null;
  const screenedAt = compact?.screened_at ?? unified?.timestamp ?? null;

  const rawMatches = compact?.matches ?? [];
  const matches = rawMatches.map((m, i) => {
    const dataset = classifyDataset(m.list_source, m.match_type);
    return {
      match_id: `${screeningReference || 'scr'}-match-${i + 1}`,
      dataset,
      match_type: firstString(m.match_type) || 'name',
      confidence: typeof m.score === 'number' ? Math.round(m.score * 100) / 100 : 0,
      requires_manual_review: true,
    };
  });

  const datasets = Array.from(
    new Set(compact?.lists_checked ?? matches.map((m) => m.dataset)),
  );

  const pepMatch = matches.some((m) => m.dataset === 'pep');
  const sanctionsMatch = matches.some((m) => m.dataset === 'sanctions');
  const adverseMediaMatch = matches.some((m) => m.dataset === 'adverse_media');

  const matchFound = compact?.match_found ?? matches.length > 0;
  const riskLevel = mapRiskLevel(compact?.risk_level ?? unified?.summary?.risk_level);
  const score = matches.length > 0
    ? Math.max(...matches.map((m) => m.confidence))
    : 0;

  // status: never "clear" when there is a match.
  const status = matchFound
    ? 'hit'
    : riskLevel === 'high'
      ? 'high_risk'
      : riskLevel === 'medium'
        ? 'medium_risk'
        : 'clear';

  return {
    status,
    risk_level: riskLevel,
    score,
    screening_reference: screeningReference,
    screened_at: screenedAt,
    datasets: datasets.length ? datasets : ['sanctions', 'pep', 'adverse_media'],
    pep_match: pepMatch,
    sanctions_match: sanctionsMatch,
    adverse_media_match: adverseMediaMatch,
    matches,
  };
}

/** Resolve a public base URL for outbound API links (face-crop download). */
export function resolvePublicApiBase(): string {
  const base = process.env.API_PUBLIC_URL
    || process.env.FRONTEND_URL
    || `http://localhost:${config.port}`;
  return base.replace(/\/+$/, '');
}

function faceCropSecret(): string {
  return config.encryptionKey || config.apiKeySecret || 'kabila-face-crop';
}

/**
 * Stateless HMAC-signed download token for the face-crop endpoint.
 * Format: `<expiresAtUnix>.<hexSignature>` where the signature is
 * HMAC-SHA256 over `verificationId:expiresAtUnix`.
 */
export function createFaceCropToken(verificationId: string, expiresAtMs: number): string {
  const exp = Math.floor(expiresAtMs / 1000);
  const sig = crypto
    .createHmac('sha256', faceCropSecret())
    .update(`${verificationId}:${exp}`)
    .digest('hex');
  return `${exp}.${sig}`;
}

/** Verify a face-crop token is authentic and unexpired for this verification. */
export function verifyFaceCropToken(token: string | undefined, verificationId: string): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = crypto
    .createHmac('sha256', faceCropSecret())
    .update(`${verificationId}:${exp}`)
    .digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

/** SHA-256 of a buffer, hex-encoded. */
export function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Build the face-crop photo info block for a webhook payload. */
export function buildFaceCropPhoto(
  verificationId: string,
  idFaceSha256: string | null,
): WebhookPayload['photos'] {
  const expiresAt = new Date(Date.now() + FACE_CROP_TTL_MS);
  const token = createFaceCropToken(verificationId, expiresAt.getTime());
  return {
    face_crop_url: `${resolvePublicApiBase()}/api/v1/verification/${verificationId}/face-crop?token=${token}`,
    face_crop_expires_at: expiresAt.toISOString(),
    photo_sha256: idFaceSha256,
    content_type: 'image/jpeg',
  };
}

/**
 * Extract the SHA-256 of the cropped ID face (from session state, in memory).
 * Returns null when no crop is available (e.g. no face detected).
 */
export function idFaceSha256(state: SessionState): string | null {
  const dataUri = state.front_extraction?.id_face_base64;
  if (typeof dataUri !== 'string') return null;
  const match = dataUri.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  try {
    return sha256Hex(Buffer.from(match[1].replace(/\s/g, ''), 'base64'));
  } catch {
    return null;
  }
}

export interface BuildPayloadOptions {
  event: string;
  verificationId: string;
  /** Internal Kabila user UUID (fallback when no external_user_id was set). */
  userId: string;
  state: SessionState;
  status: string;
  eventId: string;
  serviceCtx?: { is_service: boolean; service_product: string | null; service_environment: string | null };
  reviewReason?: string | null;
  failureReason?: string | null;
}

/**
 * Build the complete enriched webhook payload (Section 2 of the Odoo spec).
 *
 * Emits the legacy `data` envelope for backwards compatibility AND the new
 * top-level `verification` / `scores` / `aml_screening` / `photos` / `links`
 * blocks, plus the external correlation metadata echoed unchanged.
 */
export async function buildVerificationWebhookPayload(opts: BuildPayloadOptions): Promise<WebhookPayload> {
  const corr = await loadCorrelationFields(opts.verificationId);
  const timestamp = new Date().toISOString();

  // Echo the original opaque user_id the external system supplied; fall back to
  // the internal UUID for integrations that never sent one.
  const echoedUserId = corr.external_user_id ?? corr.internal_user_id ?? opts.userId;

  const legacyData: WebhookPayload['data'] = {
    ocr_data: opts.state.front_extraction?.ocr ?? undefined,
    face_match_score: opts.state.face_match?.similarity_score ?? undefined,
    liveness_score: opts.state.liveness?.score ?? undefined,
    liveness_passed: opts.state.liveness?.passed ?? undefined,
    liveness_threshold: opts.state.liveness?.threshold ?? undefined,
    liveness_provider: opts.state.liveness?.provider ?? undefined,
    liveness_mode: opts.state.liveness?.mode ?? undefined,
    liveness_signals: opts.state.liveness?.signals ?? undefined,
    liveness_checks: (opts.state.liveness as any)?.checks ?? undefined,
    manual_review_reason: opts.reviewReason ?? undefined,
    failure_reason: opts.failureReason ?? opts.state.rejection_detail ?? undefined,
    aml_screening: opts.state.aml_screening ?? undefined,
    screening_reference: opts.state.unified_screening?.reference ?? undefined,
    screening_summary: opts.state.unified_screening?.summary ?? undefined,
  };

  const faceCropSha = idFaceSha256(opts.state);

  return {
    event: opts.event,
    event_id: opts.eventId,
    user_id: echoedUserId,
    internal_user_id: corr.internal_user_id ?? opts.userId,
    verification_id: opts.verificationId,
    status: opts.status as WebhookPayload['status'],
    timestamp,
    created_at: timestamp,
    failure_reason: opts.failureReason ?? opts.state.rejection_detail ?? null,
    review_reason: opts.reviewReason ?? null,
    external_system: corr.external_system,
    external_reference: corr.external_reference,
    subject_type: corr.subject_type,
    odoo_partner_id: corr.odoo_partner_id,
    odoo_guarantor_id: corr.odoo_guarantor_id,
    odoo_lead_id: corr.odoo_lead_id,
    ...(opts.serviceCtx ? {
      is_service: opts.serviceCtx.is_service,
      service_product: opts.serviceCtx.service_product,
      service_environment: opts.serviceCtx.service_environment,
    } : {}),
    verification: buildIdentityBlock(opts.state),
    scores: buildScores(opts.state),
    aml_screening: normalizeAmlScreening(opts.state),
    photos: buildFaceCropPhoto(opts.verificationId, faceCropSha),
    links: {
      verification_url: `${resolvePublicApiBase()}/app/verification/${opts.verificationId}`,
    },
    data: legacyData,
  };
}
