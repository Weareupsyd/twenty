import { asRecord, cquery, firstString, optionalQuery } from './query.js';
import { StorageService } from '@/services/storage.js';
import { isUuid, parseDisplayRef, shortRef } from './ids.js';
import {
  compareIdentity,
  shapeMatch,
  toSummary,
  type AuditEvent,
  type IdentityField,
  type SubjectSummary,
} from './shape.js';

type VerificationRow = {
  id: string;
  user_id: string | null;
  developer_id: string | null;
  status: string;
  ocr_data: unknown;
  external_reference?: string | null;
  external_system?: string | null;
  subject_type?: string | null;
  odoo_partner_id?: string | null;
  odoo_guarantor_id?: string | null;
  odoo_lead_id?: string | null;
  face_match_score: number | null;
  liveness_score?: number | null;
  cross_validation_score?: number | null;
  photo_consistency_score?: number | null;
  address_match_score?: number | null;
  address_verification_status?: string | null;
  verification_mode?: string | null;
  age_threshold?: number | null;
  failure_reason?: string | null;
  manual_review_reason: string | null;
  session_token_expires_at?: Date | null;
  created_at: Date;
  updated_at: Date | null;
};

type LinkRow = {
  id: string;
  kyc_user_id: string | null;
  verification_id: string | null;
  screening_ref: string | null;
  full_name: string | null;
  date_of_birth: string | null;
  country: string | null;
  display_ref: string | null;
  created_at: Date;
};

type DecisionRow = {
  id: string;
  subject_id: string | null;
  verification_id: string | null;
  screening_ref: string | null;
  decision: string;
  reason: string | null;
  decided_by: string | null;
  evidence: unknown;
  created_at: Date;
  decided_by_name?: string | null;
};

type KycAmlRow = {
  id: string;
  full_name: string;
  risk_level: string;
  match_found: boolean;
  matches: unknown;
  lists_checked: string[] | null;
  screened_at: Date;
};

type ScreeningRow = {
  reference: string;
  input_name: string;
  request_type: string;
  risk_level: string;
  match_found: boolean;
  max_score: number | null;
  yente_result: unknown;
  input_payload: unknown;
  created_at: Date;
};

function scorePercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  return Math.round(numeric <= 1 ? numeric * 100 : numeric);
}

/** True when this row is the reverse of an ID. Live uploads now set is_back_of_id; older rows are inferred from the file name. */
function isBackDocument(d: { is_back_of_id?: boolean | null; file_name?: string | null }): boolean {
  if (d.is_back_of_id === true) return true;
  if (d.is_back_of_id === false) return false;
  return /back/i.test(d.file_name || '');
}

async function loadLinks(): Promise<LinkRow[]> {
  return optionalQuery<LinkRow>(
    `SELECT id, kyc_user_id, verification_id, screening_ref, full_name, date_of_birth, country,
            COALESCE(display_ref, '') AS display_ref, created_at
     FROM compliance.subject_links
     ORDER BY created_at DESC
     LIMIT 500`,
  );
}

/**
 * Live (non-voided) verifications.
 *
 * This is the single choke point every subject list, overview counter and
 * funnel stage is derived from, so filtering voided rows out here is what
 * makes a "deleted" verification stop counting everywhere at once.
 *
 * The voided_at column arrives with migration
 * 20260823_add_verification_void_and_expiry_extension.sql. optionalQuery only
 * swallows missing-*table* errors, not missing-*column* ones, so on a database
 * that has not been migrated yet we fall back to the unfiltered query rather
 * than letting the whole subject queue 500. Once migrated, the filtered query
 * is the only one that ever runs.
 */
async function loadLiveVerifications(): Promise<VerificationRow[]> {
  const columns = `id, user_id, developer_id, status, ocr_data, face_match_score,
              external_reference,
              manual_review_reason, session_token_expires_at, created_at, updated_at`;
  try {
    const { rows } = await cquery<VerificationRow>(
      `SELECT ${columns}
       FROM public.verification_requests
       WHERE voided_at IS NULL
       ORDER BY created_at DESC
       LIMIT 200`,
    );
    return rows;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/voided_at|column .* does not exist/i.test(msg)) {
      if (/does not exist|undefined table/i.test(msg)) return [];
      throw err;
    }
    return optionalQuery<VerificationRow>(
      `SELECT ${columns}
       FROM public.verification_requests
       ORDER BY created_at DESC
       LIMIT 200`,
    );
  }
}

async function loadDecisions(): Promise<DecisionRow[]> {
  return optionalQuery<DecisionRow>(
    `SELECT d.id, d.subject_id, d.verification_id, d.screening_ref, d.decision, d.reason,
            d.decided_by, d.evidence, d.created_at, s.full_name AS decided_by_name
     FROM compliance.decisions d
     LEFT JOIN compliance.staff s ON s.id = d.decided_by
     ORDER BY d.created_at DESC
     LIMIT 500`,
  );
}

async function loadScreenings(): Promise<ScreeningRow[]> {
  return optionalQuery<ScreeningRow>(
    `SELECT reference, input_name, request_type, risk_level, match_found, max_score,
            yente_result, input_payload, created_at
     FROM aml.screening_requests
     ORDER BY created_at DESC
     LIMIT 500`,
  );
}

function topicsFrom(yente: unknown): string[] {
  const data = asRecord(yente);
  const matches = Array.isArray(data.matches) ? data.matches as Array<Record<string, unknown>> : [];
  const topics: string[] = [];
  for (const m of matches) {
    const t = m.topics || m.risk_categories;
    if (Array.isArray(t)) topics.push(...t.map(String));
  }
  return topics;
}

export async function listSubjects(opts: {
  q?: string;
  kind?: string;
  limit?: number;
  offset?: number;
}): Promise<{ total: number; items: SubjectSummary[] }> {
  const limit = Math.min(opts.limit || 50, 200);
  const offset = opts.offset || 0;
  const [verifications, businesses, links, decisions, screenings] = await Promise.all([
    loadLiveVerifications(),
    optionalQuery<{
      id: string;
      legal_name: string | null;
      jurisdiction: string | null;
      status: string;
      user_provided_data: unknown;
      created_at: Date;
      session_number: string | null;
    }>(
      `SELECT id, legal_name, jurisdiction, status, user_provided_data, created_at, session_number
       FROM public.business_sessions
       WHERE parent_session_id IS NULL
       ORDER BY created_at DESC
       LIMIT 200`,
    ),
    loadLinks(),
    loadDecisions(),
    loadScreenings(),
  ]);

  const linkByVerification = new Map<string, LinkRow>();
  const linkByScreen = new Map<string, LinkRow>();
  for (const link of links) {
    // loadLinks() is newest-first. Keep the first link so a new full Yente
    // screen supersedes an older SCR-KAB compact mirror for the same subject.
    if (link.verification_id && !linkByVerification.has(link.verification_id)) {
      linkByVerification.set(link.verification_id, link);
    }
    if (link.screening_ref && !linkByScreen.has(link.screening_ref)) {
      linkByScreen.set(link.screening_ref, link);
    }
  }
  const decisionBySubject = new Map<string, DecisionRow>();
  const decisionByVerification = new Map<string, DecisionRow>();
  const decisionByScreen = new Map<string, DecisionRow>();
  for (const d of decisions) {
    if (d.subject_id && !decisionBySubject.has(d.subject_id)) decisionBySubject.set(d.subject_id, d);
    if (d.verification_id && !decisionByVerification.has(d.verification_id)) decisionByVerification.set(d.verification_id, d);
    if (d.screening_ref && !decisionByScreen.has(d.screening_ref)) decisionByScreen.set(d.screening_ref, d);
  }
  const screenByRef = new Map(screenings.map((s) => [s.reference, s]));
  const screenByName = new Map<string, ScreeningRow>();
  for (const s of screenings) {
    const key = s.input_name.trim().toLowerCase();
    if (key && !screenByName.has(key)) screenByName.set(key, s);
  }

  const items: SubjectSummary[] = [];

  for (const v of verifications) {
    const ocr = asRecord(v.ocr_data);
    const link = linkByVerification.get(v.id);
    const screen = (link?.screening_ref && screenByRef.get(link.screening_ref))
      || screenByName.get(firstString(ocr.full_name, ocr.name).toLowerCase());
    const name = firstString(link?.full_name, ocr.full_name, ocr.name) || 'Unknown subject';
    const recorded = decisionByVerification.get(v.id)?.decision
      || (link && decisionBySubject.get(link.id)?.decision)
      || (screen && decisionByScreen.get(screen.reference)?.decision)
      || null;
    items.push(toSummary({
      id: v.id,
      kind: 'individual',
      name,
      country: link?.country || firstString(ocr.nationality, ocr.country) || null,
      verificationStatus: v.status,
      screeningRisk: screen?.risk_level,
      matchFound: screen?.match_found,
      topics: screen ? topicsFrom(screen.yente_result) : [],
      maxScore: screen?.max_score ?? null,
      submittedAt: v.created_at,
      recordedDecision: recorded,
      screeningRef: screen?.reference || link?.screening_ref || null,
      // Backed by a real verification_requests row: can be voided + extended.
      deletable: true,
      expiresAt: v.session_token_expires_at ?? null,
      externalReference: v.external_reference ?? null,
    }));
  }

  for (const b of businesses) {
    const provided = asRecord(b.user_provided_data);
    const name = b.legal_name || firstString(provided.legal_name) || 'Unnamed business';
    const screen = screenByName.get(name.toLowerCase());
    const recorded = decisionBySubject.get(b.id)?.decision
      || (screen && decisionByScreen.get(screen.reference)?.decision)
      || null;
    items.push(toSummary({
      id: b.id,
      kind: 'business',
      name,
      country: b.jurisdiction || firstString(provided.jurisdiction, provided.country) || null,
      verificationStatus: b.status,
      screeningRisk: screen?.risk_level,
      matchFound: screen?.match_found,
      topics: screen ? topicsFrom(screen.yente_result) : [],
      maxScore: screen?.max_score ?? null,
      submittedAt: b.created_at,
      recordedDecision: recorded,
      screeningRef: screen?.reference || null,
    }));
  }

  // Screening-only rows that never went through KYC.
  const knownScreens = new Set(items.map((i) => i.screening_ref).filter(Boolean));
  for (const s of screenings) {
    if (knownScreens.has(s.reference)) continue;
    const payload = asRecord(s.input_payload);
    items.push(toSummary({
      id: s.reference,
      kind: s.request_type === 'company' ? 'business' : 'individual',
      name: s.input_name,
      country: firstString(payload.country, payload.nationality) || null,
      verificationStatus: 'not_run',
      screeningRisk: s.risk_level,
      matchFound: s.match_found,
      topics: topicsFrom(s.yente_result),
      maxScore: s.max_score,
      submittedAt: s.created_at,
      recordedDecision: decisionByScreen.get(s.reference)?.decision || null,
      screeningRef: s.reference,
    }));
  }

  items.sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')));

  let filtered = items;
  if (opts.kind === 'individual' || opts.kind === 'business') {
    filtered = filtered.filter((i) => i.kind === opts.kind);
  }
  if (opts.q) {
    const q = opts.q.toLowerCase();
    filtered = filtered.filter((i) =>
      i.name.toLowerCase().includes(q)
      || i.ref.toLowerCase().includes(q)
      || i.id.toLowerCase().includes(q)
      || (i.screening_ref || '').toLowerCase().includes(q)
      || (i.external_reference || '').toLowerCase().includes(q));
  }
  return { total: filtered.length, items: filtered.slice(offset, offset + limit) };
}

async function resolveId(id: string): Promise<{ kind: 'verification' | 'business' | 'screening'; id: string } | null> {
  const raw = id.trim();
  if (raw.startsWith('SCR-')) return { kind: 'screening', id: raw };
  const parsed = parseDisplayRef(raw);
  if (isUuid(raw)) {
    const v = await optionalQuery<{ id: string }>('SELECT id FROM public.verification_requests WHERE id = $1', [raw]);
    if (v[0]) return { kind: 'verification', id: v[0].id };
    const b = await optionalQuery<{ id: string }>('SELECT id FROM public.business_sessions WHERE id = $1', [raw]);
    if (b[0]) return { kind: 'business', id: b[0].id };
    const link = await optionalQuery<{ verification_id: string | null; screening_ref: string | null }>(
      'SELECT verification_id, screening_ref FROM compliance.subject_links WHERE id = $1',
      [raw],
    );
    if (link[0]?.verification_id) return { kind: 'verification', id: link[0].verification_id };
    if (link[0]?.screening_ref) return { kind: 'screening', id: link[0].screening_ref };
  }
  if (parsed) {
    const listed = await listSubjects({ limit: 200 });
    const hit = listed.items.find((i) => i.ref === `${parsed.prefix}-${parsed.digits}` || i.ref === raw.toUpperCase());
    if (hit) {
      if (hit.kind === 'business') return { kind: 'business', id: hit.id };
      if (hit.id.startsWith('SCR-')) return { kind: 'screening', id: hit.id };
      return { kind: 'verification', id: hit.id };
    }
    const byDisplay = await optionalQuery<{ verification_id: string | null; screening_ref: string | null }>(
      'SELECT verification_id, screening_ref FROM compliance.subject_links WHERE display_ref = $1',
      [raw.toUpperCase()],
    );
    if (byDisplay[0]?.verification_id) return { kind: 'verification', id: byDisplay[0].verification_id };
    if (byDisplay[0]?.screening_ref) return { kind: 'screening', id: byDisplay[0].screening_ref };
  }
  return null;
}

export async function getSubjectFile(id: string): Promise<Record<string, unknown> | null> {
  const resolved = await resolveId(id);
  if (!resolved) return null;

  if (resolved.kind === 'business') {
    const { getBusinessFile } = await import('./business.js');
    return getBusinessFile(resolved.id);
  }

  let verification: VerificationRow | undefined;
  let screening: ScreeningRow | undefined;

  if (resolved.kind === 'verification') {
    verification = (await optionalQuery<VerificationRow>(
      `SELECT id, user_id, developer_id, status, ocr_data, face_match_score,
              liveness_score, cross_validation_score, photo_consistency_score,
              address_match_score, address_verification_status, verification_mode,
              age_threshold, failure_reason, manual_review_reason,
              external_reference, external_system, subject_type,
              odoo_partner_id, odoo_guarantor_id, odoo_lead_id,
              created_at, updated_at
       FROM public.verification_requests WHERE id = $1`,
      [resolved.id],
    ))[0];
  } else {
    screening = (await optionalQuery<ScreeningRow>(
      `SELECT reference, input_name, request_type, risk_level, match_found, max_score,
              yente_result, input_payload, created_at
       FROM aml.screening_requests WHERE reference = $1`,
      [resolved.id],
    ))[0];
  }

  if (!verification && !screening) return null;

  const links = await optionalQuery<LinkRow>(
    `SELECT id, kyc_user_id, verification_id, screening_ref, full_name, date_of_birth, country,
            COALESCE(display_ref, '') AS display_ref, created_at
     FROM compliance.subject_links
     WHERE verification_id = $1 OR screening_ref = $2 OR kyc_user_id::text = $3
     ORDER BY created_at DESC`,
    [verification?.id || null, screening?.reference || null, verification?.user_id || null],
  );
  const link = links[0];

  if (!screening && link?.screening_ref) {
    screening = (await optionalQuery<ScreeningRow>(
      `SELECT reference, input_name, request_type, risk_level, match_found, max_score,
              yente_result, input_payload, created_at
       FROM aml.screening_requests WHERE reference = $1`,
      [link.screening_ref],
    ))[0];
  }
  if (!screening && verification) {
    const ocr = asRecord(verification.ocr_data);
    const name = firstString(ocr.full_name, ocr.name);
    if (name) {
      screening = (await optionalQuery<ScreeningRow>(
        `SELECT reference, input_name, request_type, risk_level, match_found, max_score,
                yente_result, input_payload, created_at
         FROM aml.screening_requests
         WHERE lower(input_name) = lower($1)
         ORDER BY created_at DESC LIMIT 1`,
        [name],
      ))[0];
    }
  }

  const docs = verification
    ? await optionalQuery<{
      id: string;
      file_name: string | null;
      file_path: string | null;
      file_size: number | null;
      mime_type: string | null;
      document_type: string | null;
      ocr_data: unknown;
      quality_score: number | null;
      is_back_of_id: boolean | null;
      created_at: Date;
    }>(
      `SELECT id, file_name, file_path, file_size, mime_type, document_type, ocr_data,
              quality_score, is_back_of_id, created_at
       FROM public.documents WHERE verification_request_id = $1
       ORDER BY created_at ASC`,
      [verification.id],
    )
    : [];
  const selfies = verification
    ? await optionalQuery<{
      id: string;
      file_name: string | null;
      file_path: string | null;
      file_size: number | null;
      liveness_score: number | null;
      face_detected: boolean | null;
      created_at: Date;
    }>(
      `SELECT id, file_name, file_path, file_size, liveness_score, face_detected, created_at
       FROM public.selfies WHERE verification_request_id = $1
       ORDER BY created_at ASC`,
      [verification.id],
    )
    : [];

  const verificationContext = verification
    ? (await optionalQuery<{ context: unknown }>(
      `SELECT context FROM public.verification_contexts WHERE verification_id = $1`,
      [verification.id],
    ))[0]
    : undefined;
  const context = asRecord(verificationContext?.context);
  const frontContext = asRecord(context.front_extraction);
  const idFace = typeof frontContext.id_face_base64 === 'string' && frontContext.id_face_base64.startsWith('data:image/')
    ? frontContext.id_face_base64
    : null;
  const kycAml = verification
    ? (await optionalQuery<KycAmlRow>(
      `SELECT id, full_name, risk_level, match_found, matches, lists_checked, screened_at
       FROM public.aml_screenings
       WHERE verification_request_id = $1
       ORDER BY screened_at DESC LIMIT 1`,
      [verification.id],
    ))[0]
    : undefined;

  const decisions = await optionalQuery<DecisionRow>(
    `SELECT d.id, d.subject_id, d.verification_id, d.screening_ref, d.decision, d.reason,
            d.decided_by, d.evidence, d.created_at, s.full_name AS decided_by_name
     FROM compliance.decisions d
     LEFT JOIN compliance.staff s ON s.id = d.decided_by
     WHERE d.verification_id = $1 OR d.screening_ref = $2 OR d.subject_id = $3
     ORDER BY d.created_at DESC`,
    [verification?.id || null, screening?.reference || null, verification?.id || link?.id || null],
  );

  const docFront = docs.find((d) => !isBackDocument(d));
  const docBack = docs.find((d) => isBackDocument(d));
  const rawFrontOcr = asRecord(docFront?.ocr_data);
  const rawBackOcr = asRecord(docBack?.ocr_data);
  const vrOcr = asRecord(verification?.ocr_data);
  const frontExtractionOcr = asRecord(frontContext.ocr);
  const backExtractionOcr = asRecord(asRecord(context.back_extraction).ocr);
  const rawQr = asRecord(asRecord(context.back_extraction).qr_payload);
  // Session state stores the MRZ as back_extraction.mrz_result with a nested
  // `fields` record (see BackExtractionResultSchema) - the flat values (sex,
  // nationality, document_number, …) live inside `fields`. Older records used
  // a flat `mrz_data` key, so keep it as a fallback.
  const backExtraction = asRecord(context.back_extraction);
  const mrz = {
    ...asRecord(backExtraction.mrz_data),
    ...asRecord(asRecord(backExtraction.mrz_result).fields),
  };

  // Combine all extraction channels with priority
  const combinedOcr: Record<string, unknown> = {
    ...rawBackOcr,
    ...backExtractionOcr,
    ...rawQr,
    ...mrz,
    ...vrOcr,
    ...rawFrontOcr,
    ...frontExtractionOcr,
  };

  // Format document type cleanly
  const rawDocType = docFront?.document_type || docBack?.document_type || verification?.verification_mode || (combinedOcr.document_type as string) || (combinedOcr.detected_document_type as string) || 'national_id';
  const docType = rawDocType === 'national_id' ? 'National ID'
    : rawDocType === 'passport' ? 'Passport'
    : rawDocType === 'drivers_license' ? "Driver's License"
    : rawDocType.replace(/_/g, ' ');

  // Document number
  const docNum = firstString(
    combinedOcr.document_number,
    combinedOcr.id_number,
    combinedOcr.nin,
    combinedOcr.card_number,
    combinedOcr.card_no,
    combinedOcr.licenseNumber,
    combinedOcr.passport_number,
    combinedOcr.serial_number,
    combinedOcr.documentNumber,
    combinedOcr.idNumber,
  );

  // Expiry date
  const expiry = firstString(
    combinedOcr.expiration_date,
    combinedOcr.expiry_date,
    combinedOcr.expiry,
    combinedOcr.date_of_expiry,
    combinedOcr.expirationDate,
    combinedOcr.expires,
    combinedOcr.valid_until,
  );

  // Nationality / Country (sanitized from OCR label artifacts like "SEX DATE OF BIRTH")
  const rawNat = firstString(combinedOcr.nationality, combinedOcr.country, combinedOcr.issuing_country);
  let nat: string | null = (rawNat && !/sex|birth|gender/i.test(rawNat)) ? rawNat.trim() : null;
  if (!nat || nat.length > 30) {
    nat = (combinedOcr.issuing_country as string) || link?.country || (docNum && /^(?:CM|CF|UG)/i.test(docNum) ? 'UGA' : null);
  }
  if (nat && /ugand|uga/i.test(nat)) {
    nat = 'UGA';
  }

  // DOB & Age calculation
  const dob = firstString(combinedOcr.date_of_birth, combinedOcr.dob, combinedOcr.birthDate, combinedOcr.dateOfBirth, combinedOcr.birth_date);
  let declaredAge: number | null = null;
  if (dob) {
    const d = new Date(dob);
    if (!Number.isNaN(d.getTime())) {
      const today = new Date();
      declaredAge = today.getFullYear() - d.getFullYear();
      if (today.getMonth() < d.getMonth() || (today.getMonth() === d.getMonth() && today.getDate() < d.getDate())) {
        declaredAge--;
      }
    }
  }

  const ageEstimation = asRecord(context.age_estimation);
  const liveFaceAge = ageEstimation.live_face_age != null ? Number(ageEstimation.live_face_age) : null;
  const docFaceAge = ageEstimation.document_face_age != null ? Number(ageEstimation.document_face_age) : null;
  const ageDiscrepancy = ageEstimation.age_discrepancy != null ? Number(ageEstimation.age_discrepancy) : (
    (declaredAge != null && liveFaceAge != null) ? Math.abs(liveFaceAge - declaredAge) : null
  );

  let ageDisplay: string | null = null;
  if (declaredAge != null && liveFaceAge != null) {
    ageDisplay = `${declaredAge} yrs (DOB) · ~${liveFaceAge} yrs (live face)`;
  } else if (declaredAge != null) {
    ageDisplay = `${declaredAge} yrs (DOB)`;
  } else if (liveFaceAge != null) {
    ageDisplay = `~${liveFaceAge} yrs (live face)`;
  }

  const fullName = firstString(combinedOcr.full_name, combinedOcr.name, combinedOcr.fullName, combinedOcr.formatted_name);
  const rawSex = firstString(combinedOcr.sex, combinedOcr.gender);
  const sex = (rawSex && !/date|birth|nationality/i.test(rawSex)) ? (/^f/i.test(rawSex) ? 'F' : /^m/i.test(rawSex) ? 'M' : rawSex) : null;
  const address = firstString(combinedOcr.address, combinedOcr.residence, combinedOcr.full_address);
  const phone = firstString(combinedOcr.phone, combinedOcr.phone_number, combinedOcr.mobile);

  const extracted: Record<string, unknown> = {
    ...combinedOcr,
    full_name: fullName,
    date_of_birth: dob,
    document_type: docType,
    document_number: docNum,
    expiration_date: expiry,
    expiry_date: expiry,
    nationality: nat,
    country: nat,
    age_display: ageDisplay,
    declared_age: declaredAge,
    sex,
    address,
    phone,
  };

  const submitted: Record<string, unknown> = {
    ...extracted,
    full_name: link?.full_name || extracted.full_name,
    date_of_birth: link?.date_of_birth || extracted.date_of_birth,
    country: (link?.country && !/sex|birth/i.test(link.country)) ? link.country : extracted.country,
    nationality: (link?.country && !/sex|birth/i.test(link.country)) ? link.country : extracted.nationality,
  };
  const yente = asRecord(screening?.yente_result);
  const rawMatches = Array.isArray(yente.matches) ? yente.matches as Array<Record<string, unknown>> : [];
  const matches = rawMatches.map((m) => shapeMatch(m));
  let fullMatches: Array<Record<string, unknown>> = [];
  let screeningFreshness: {
    dataset_version: string | null;
    last_successful_sync: Date | string | null;
    entity_count?: number;
  } | null = null;
  if (screening) {
    const [{ formatMatch }, { getDataFreshness }] = await Promise.all([
      import('../aml/screen.js'),
      import('../aml/audit.js'),
    ]);
    fullMatches = rawMatches.map((match) => formatMatch(match));
    screeningFreshness = await getDataFreshness();
  }
  const relationships = Array.isArray(yente.relationships)
    ? yente.relationships as Array<Record<string, unknown>>
    : fullMatches.flatMap((match) => Array.isArray(match.relationships)
      ? match.relationships as Array<Record<string, unknown>>
      : []);
  const screeningCategories = fullMatches.flatMap((match) =>
    Array.isArray(match.risk_categories) ? match.risk_categories.map(String) : []);
  const sanctionsMatches = screeningCategories.filter((category) => category.toLowerCase().includes('sanction')).length;
  const pepMatches = screeningCategories.filter((category) => category.toLowerCase().includes('pep')).length;
  const kycMatches = Array.isArray(kycAml?.matches)
    ? (kycAml.matches as Array<Record<string, unknown>>).map((match) => ({
      name: firstString(match.listed_name, match.name, match.caption) || 'Unknown match',
      source: firstString(match.list_source, match.source, match.dataset) || '-',
      score: Number(match.score ?? 0),
      type: firstString(match.match_type, match.type) || 'match',
    }))
    : [];
  const name = firstString(link?.full_name, extracted.full_name, screening?.input_name) || 'Unknown subject';
  const country = (link?.country && !/sex|birth/i.test(link.country)) ? link.country : (extracted.nationality as string) || (extracted.country as string) || null;
  const summary = toSummary({
    id: verification?.id || screening!.reference,
    kind: 'individual',
    name,
    country,
    verificationStatus: verification?.status || 'not_run',
    screeningRisk: screening?.risk_level,
    matchFound: screening?.match_found,
    topics: topicsFrom(screening?.yente_result),
    maxScore: screening?.max_score ?? null,
    submittedAt: verification?.created_at || screening?.created_at || null,
    recordedDecision: decisions[0]?.decision || null,
    screeningRef: screening?.reference || null,
  });

  const face = verification?.face_match_score != null
    ? (Number(verification.face_match_score) <= 1
      ? Math.round(Number(verification.face_match_score) * 100)
      : Math.round(Number(verification.face_match_score)))
    : null;
  const livenessRaw = verification?.liveness_score ?? selfies[0]?.liveness_score;
  const liveness = livenessRaw != null
    ? (Number(livenessRaw) <= 1
      ? Math.round(Number(livenessRaw) * 100)
      : Math.round(Number(livenessRaw)))
    : null;
  const docConfidence = docs[0]?.quality_score != null
    ? (Number(docs[0].quality_score) <= 1
      ? Math.round(Number(docs[0].quality_score) * 100)
      : Math.round(Number(docs[0].quality_score)))
    : null;

  const audit: AuditEvent[] = [];
  if (verification) {
    audit.push({
      at: new Date(verification.created_at).toISOString(),
      title: 'Session started',
      detail: 'verify · hosted session',
    });
  }
  for (const doc of docs) {
    audit.push({
      at: new Date(doc.created_at).toISOString(),
      title: isBackDocument(doc) ? 'Back document captured' : 'Front document captured',
      detail: `verify · ${doc.document_type || 'document'}${docConfidence != null ? ` · OCR confidence ${docConfidence}%` : ''}`,
    });
  }
  for (const selfie of selfies) {
    audit.push({
      at: new Date(selfie.created_at).toISOString(),
      title: 'Live capture',
      detail: `verify · liveness ${selfie.liveness_score ?? '-'} · face ${selfie.face_detected ? 'detected' : 'missing'}`,
    });
  }
  if (kycAml) {
    audit.push({
      at: new Date(kycAml.screened_at).toISOString(),
      title: 'KYC AML screening completed',
      detail: `verify · ${kycAml.risk_level} · ${kycMatches.length} matches · ${(kycAml.lists_checked || []).length} lists`,
    });
  }
  if (screening) {
    audit.push({
      at: new Date(screening.created_at).toISOString(),
      title: 'Combined screening completed',
      detail: `screen · ${screening.reference} · ${screening.risk_level} · ${rawMatches.length} candidates`,
    });
  }
  for (const d of [...decisions].reverse()) {
    audit.push({
      at: new Date(d.created_at).toISOString(),
      title: `Decision: ${d.decision}`,
      detail: `${d.decided_by_name || 'staff'}${d.reason ? ` · ${d.reason}` : ''}`,
    });
  }
  audit.sort((a, b) => a.at.localeCompare(b.at));

  return {
    id: summary.id,
    ref: summary.ref,
    kind: summary.kind,
    name: summary.name,
    country: summary.country,
    submitted_at: summary.submitted_at,
    source: verification ? 'verification' : 'screening',
    verification: {
      id: verification?.id || null,
      status: summary.verification,
      raw_status: verification?.status || null,
      mode: verification?.verification_mode || null,
      age_threshold: verification?.age_threshold ?? null,
      doc_confidence: docConfidence,
      face_match: face,
      liveness,
      cross_validation: scorePercent(verification?.cross_validation_score),
      photo_consistency: scorePercent(verification?.photo_consistency_score),
      address_match: scorePercent(verification?.address_match_score),
      address_status: verification?.address_verification_status || null,
      age_estimation: {
        declared_age: declaredAge,
        live_face_age: liveFaceAge,
        document_face_age: docFaceAge,
        age_discrepancy: ageDiscrepancy,
      },
      failure_reason: verification?.failure_reason || null,
      manual_review_reason: verification?.manual_review_reason || null,
      fields: compareIdentity({ submitted, extracted }),
      media: {
        documents: docs.map((d) => ({
          id: d.id,
          name: d.file_name,
          type: d.document_type,
          size: d.file_size,
          mime: d.mime_type,
          back: isBackDocument(d),
          url: `/api/subjects/${encodeURIComponent(String(summary.id))}/media/${d.id}`,
        })),
        selfies: selfies.map((s) => ({
          id: s.id,
          name: s.file_name,
          size: s.file_size,
          liveness: s.liveness_score,
          url: `/api/subjects/${encodeURIComponent(String(summary.id))}/media/${s.id}`,
        })),
        id_crop: idFace
          ? { available: true, url: `/api/subjects/${encodeURIComponent(String(summary.id))}/media/id-crop` }
          : { available: false, url: null },
      },
    },
    kyc_aml: {
      id: kycAml?.id || null,
      status: kycAml ? (kycAml.match_found ? 'match_found' : 'clear') : 'not_run',
      risk_level: kycAml?.risk_level || null,
      match_found: kycAml?.match_found ?? false,
      match_count: kycMatches.length,
      matches: kycMatches,
      lists_checked: kycAml?.lists_checked || [],
      screened_at: kycAml?.screened_at || null,
    },
    screening: {
      reference: screening?.reference || null,
      status: summary.screening,
      risk_level: screening?.risk_level || null,
      risk_score: summary.risk,
      match_found: screening?.match_found ?? false,
      screened_at: screening?.created_at || null,
      query: asRecord(screening?.input_payload),
      summary: {
        risk_level: screening?.risk_level || null,
        match_found: screening?.match_found ?? false,
        requires_human_review: Boolean(screening?.match_found)
          || screening?.risk_level === 'High'
          || screening?.risk_level === 'Critical',
        total_matches: fullMatches.length,
        sanctions_matches: sanctionsMatches,
        pep_related_matches: pepMatches,
      },
      matches,
      full_matches: fullMatches,
      relationships,
      data_freshness: screeningFreshness,
      analyst_note: screening
        ? 'Automated screening result. Identity and relationship findings require analyst verification.'
        : null,
    },
    decision: {
      latest: decisions[0]
        ? {
          id: decisions[0].id,
          decision: decisions[0].decision,
          reason: decisions[0].reason,
          decided_by: decisions[0].decided_by_name,
          created_at: decisions[0].created_at,
        }
        : null,
      label: summary.decision,
      history: decisions,
    },
    audit,
    links: {
      user_id: verification?.user_id || link?.kyc_user_id || null,
      developer_id: verification?.developer_id || null,
      screening_ref: screening?.reference || null,
      display_ref: link?.display_ref || shortRef('SUB', summary.id),
      external_reference: verification?.external_reference || null,
      external_system: verification?.external_system || null,
      subject_type: verification?.subject_type || null,
      odoo_partner_id: verification?.odoo_partner_id || null,
      odoo_guarantor_id: verification?.odoo_guarantor_id || null,
      odoo_lead_id: verification?.odoo_lead_id || null,
    },
  };
}

export type SubjectMedia = {
  bytes: Buffer;
  mime: string;
  filename: string;
};

function mediaMime(filename: string | null, storedMime?: string | null): string {
  if (storedMime && /^(image\/(?:jpeg|png|webp)|application\/pdf)$/i.test(storedMime)) {
    return storedMime.toLowerCase();
  }
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'image/jpeg';
}

/** Read one subject-owned evidence file for the staff-only media endpoint. */
export async function getSubjectMedia(subjectId: string, mediaId: string): Promise<SubjectMedia | null> {
  const resolved = await resolveId(subjectId);
  if (!resolved || resolved.kind !== 'verification') return null;

  if (mediaId === 'id-crop') {
    const row = (await optionalQuery<{ context: unknown }>(
      `SELECT context FROM public.verification_contexts WHERE verification_id = $1`,
      [resolved.id],
    ))[0];
    const context = asRecord(row?.context);
    const front = asRecord(context.front_extraction);
    const dataUri = typeof front.id_face_base64 === 'string' ? front.id_face_base64 : '';
    const match = dataUri.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) return null;
    const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) return null;
    const mime = match[1].toLowerCase();
    const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    return { bytes, mime, filename: `id-portrait-${resolved.id}.${extension}` };
  }

  if (!isUuid(mediaId)) return null;
  const document = (await optionalQuery<{
    file_path: string | null;
    file_name: string | null;
    mime_type: string | null;
  }>(
    `SELECT file_path, file_name, mime_type
       FROM public.documents
      WHERE id = $1 AND verification_request_id = $2`,
    [mediaId, resolved.id],
  ))[0];
  if (document?.file_path) {
    const storage = new StorageService();
    return {
      bytes: await storage.downloadFile(document.file_path),
      mime: mediaMime(document.file_name, document.mime_type),
      filename: document.file_name || `document-${mediaId}`,
    };
  }

  const selfie = (await optionalQuery<{ file_path: string | null; file_name: string | null }>(
    `SELECT file_path, file_name
       FROM public.selfies
      WHERE id = $1 AND verification_request_id = $2`,
    [mediaId, resolved.id],
  ))[0];
  if (!selfie?.file_path) return null;
  const storage = new StorageService();
  return {
    bytes: await storage.downloadFile(selfie.file_path),
    mime: mediaMime(selfie.file_name),
    filename: selfie.file_name || `live-capture-${mediaId}.jpg`,
  };
}

/**
 * Execute the same full screening pipeline used by automatic verification.
 * Idempotent for an already-linked subject: opening the page or clicking retry
 * cannot create duplicate screening records.
 */
export async function runSubjectScreening(
  subjectId: string,
  staff?: { id?: string; name?: string; email?: string } | null,
): Promise<Record<string, unknown> | null> {
  const file = await getSubjectFile(subjectId);
  if (!file) return null;

  const existingScreen = file.screening as { reference?: string | null } | undefined;
  // Native full screens are already complete. Legacy SCR-KAB mirrors contain
  // only the compact provider output, so upgrade those once through Yente.
  if (existingScreen?.reference && !/^SCR-(?:KAB|KYB)-/i.test(existingScreen.reference)) {
    return file;
  }

  const name = (file.name as string) || '';
  if (!name || name === 'Unknown subject') {
    throw Object.assign(new Error('Subject has no valid name for screening'), { status: 400 });
  }

  const verification = file.verification as any;
  const fields = (verification?.fields || []) as IdentityField[];
  const fieldValue = (label: string) => {
    const field = fields.find((item) => item.field === label);
    return field?.extracted || field?.submitted || null;
  };
  const rawNationality = fieldValue('Nationality') || (file.country as string) || null;
  const nationality = rawNationality && !/sex|birth/i.test(rawNationality) ? rawNationality : null;
  const links = (file.links || {}) as Record<string, unknown>;

  const { runUnifiedScreening } = await import('@/services/unifiedScreening.js');
  await runUnifiedScreening({
    verificationId: verification?.id || null,
    userId: typeof links.user_id === 'string' ? links.user_id : null,
    name,
    dateOfBirth: fieldValue('Date of birth'),
    nationality,
    country: nationality,
    idNumber: fieldValue('Document number'),
    gender: fieldValue('Sex / Gender'),
    address: fieldValue('Address'),
    requestedBy: staff?.email || staff?.name || 'compliance-portal',
  });

  return getSubjectFile(subjectId);
}
