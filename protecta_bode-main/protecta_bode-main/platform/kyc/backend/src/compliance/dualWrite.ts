/** App-level dual-write. Triggers in 0007_phase4.sql do the same work;
 *  these helpers cover hosts where the trigger is not installed yet. */
import { optionalQuery } from './query.js';
import { kabilaScreenRef, mapKabilaRisk } from './mapping.js';

export async function linkSubject(opts: {
  verificationId?: string | null;
  kycUserId?: string | null;
  screeningRef: string;
  fullName?: string | null;
  dateOfBirth?: string | null;
  country?: string | null;
}): Promise<void> {
  if (!opts.screeningRef) return;
  await optionalQuery(
    `INSERT INTO compliance.subject_links (
       kyc_user_id, verification_id, screening_ref, full_name, date_of_birth, country
     ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [
      opts.kycUserId || null,
      opts.verificationId || null,
      opts.screeningRef,
      opts.fullName || null,
      opts.dateOfBirth || null,
      opts.country || null,
    ],
  );
}

export async function mirrorKabilaScreening(row: {
  id?: string;
  verification_request_id?: string | null;
  full_name: string;
  date_of_birth?: string | null;
  nationality?: string | null;
  risk_level?: string | null;
  match_found?: boolean;
  matches?: unknown;
  screened_at?: string | Date | null;
  user_id?: string | null;
}): Promise<string> {
  const reference = row.id ? kabilaScreenRef(row.id, 'KAB') : `SCR-KAB-${Date.now().toString(16).toUpperCase()}`;
  await optionalQuery(
    `INSERT INTO aml.screening_requests (
       reference, request_type, status, input_name, input_payload,
       yente_result, risk_level, match_classification, match_found,
       max_score, processing_ms, requested_by, created_at,
       source, kabila_screening_id, verification_id
     ) VALUES (
       $1, 'person', 'completed', $2, $3::jsonb, $4::jsonb, $5, $6::jsonb,
       $7, $8, 0, 'kabila-addon', COALESCE($9::timestamptz, NOW()),
       'kabila', $10::uuid, $11::uuid
     )
     ON CONFLICT DO NOTHING`,
    [
      reference,
      row.full_name,
      JSON.stringify({ name: row.full_name, date_of_birth: row.date_of_birth, nationality: row.nationality, source: 'kabila' }),
      JSON.stringify({ matches: row.matches || [] }),
      mapKabilaRisk(row.risk_level),
      JSON.stringify({ sanctions: Boolean(row.match_found) }),
      Boolean(row.match_found),
      row.match_found ? 0.85 : 0.1,
      row.screened_at || null,
      row.id || null,
      row.verification_request_id || null,
    ],
  );
  await linkSubject({
    verificationId: row.verification_request_id,
    kycUserId: row.user_id,
    screeningRef: reference,
    fullName: row.full_name,
    dateOfBirth: row.date_of_birth,
    country: row.nationality,
  });
  return reference;
}

export async function mirrorKybScreening(row: {
  id?: string;
  business_session_id: string;
  key_person_id?: string | null;
  subject_type: string;
  screened_name: string;
  risk_level?: string | null;
  match_found?: boolean;
  matches?: unknown;
  screened_at?: string | Date | null;
  role_tags?: string[];
  verification_id?: string | null;
}): Promise<string> {
  const reference = row.id ? kabilaScreenRef(row.id, 'KYB') : `SCR-KYB-${Date.now().toString(16).toUpperCase()}`;
  const kind = row.subject_type === 'entity' ? 'company' : 'person';
  await optionalQuery(
    `INSERT INTO aml.screening_requests (
       reference, request_type, status, input_name, input_payload,
       yente_result, risk_level, match_classification, match_found,
       max_score, processing_ms, requested_by, created_at,
       source, kabila_screening_id, business_session_id
     ) VALUES (
       $1, $2, 'completed', $3, $4::jsonb, $5::jsonb, $6, $7::jsonb,
       $8, $9, 0, 'kabila-kyb', COALESCE($10::timestamptz, NOW()),
       'kabila-kyb', $11::uuid, $12
     )
     ON CONFLICT DO NOTHING`,
    [
      reference, kind, row.screened_name,
      JSON.stringify({ name: row.screened_name, source: 'kabila-kyb', subject_type: row.subject_type }),
      JSON.stringify({ matches: row.matches || [] }),
      mapKabilaRisk(row.risk_level),
      JSON.stringify({ sanctions: Boolean(row.match_found) }),
      Boolean(row.match_found),
      row.match_found ? 0.85 : 0.1,
      row.screened_at || null,
      row.id || null,
      row.business_session_id,
    ],
  );
  await optionalQuery(
    `INSERT INTO compliance.ubo_links (
       business_session_id, person_name, role_tags, screening_ref, verification_id
     ) VALUES ($1, $2, $3::text[], $4, $5)
     ON CONFLICT DO NOTHING`,
    [row.business_session_id, row.screened_name, row.role_tags || [], reference, row.verification_id || null],
  );
  return reference;
}
