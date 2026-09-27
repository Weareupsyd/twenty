import { optionalQuery } from './query.js';
import {
  coverageVerdict,
  kabilaScreenRef,
  normalizeName,
  planKabilaCopies,
  planNameLinks,
  type CoverageVerdict,
  type PlannedCopy,
} from './mapping.js';
import { linkSubject, mirrorKabilaScreening, mirrorKybScreening } from './dualWrite.js';

export type BackfillReport = {
  mode: 'dry-run' | 'apply';
  planned: PlannedCopy[];
  applied: { kabila: number; kyb: number; staff: number; name_links: number };
  coverage: CoverageVerdict;
};

async function loadCoverageCounts(): Promise<{ verified: number; historicallyScreened: number; linked: number }> {
  const verified = await optionalQuery<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM public.verification_requests
     WHERE status IN ('verified', 'approved')`,
  );
  const historical = await optionalQuery<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM (
       SELECT verification_request_id AS id FROM public.aml_screenings
         WHERE verification_request_id IS NOT NULL
       UNION
       SELECT verification_id FROM aml.screening_requests
         WHERE verification_id IS NOT NULL
       UNION
       SELECT verification_id FROM compliance.subject_links
         WHERE verification_id IS NOT NULL AND screening_ref IS NOT NULL
     ) t`,
  );
  const linked = await optionalQuery<{ n: string }>(
    `SELECT COUNT(DISTINCT verification_id)::text AS n
     FROM compliance.subject_links
     WHERE verification_id IS NOT NULL AND screening_ref IS NOT NULL`,
  );
  return {
    verified: Number(verified[0]?.n || 0),
    historicallyScreened: Number(historical[0]?.n || 0),
    linked: Number(linked[0]?.n || 0),
  };
}

export async function coverageAttestation(): Promise<CoverageVerdict> {
  return coverageVerdict(await loadCoverageCounts());
}

export async function runBackfill(apply: boolean): Promise<BackfillReport> {
  const kabila = await optionalQuery<{
    id: string;
    verification_request_id: string | null;
    full_name: string;
    date_of_birth: string | null;
    nationality: string | null;
    risk_level: string | null;
    match_found: boolean;
    matches: unknown;
    screened_at: Date | string | null;
  }>(`SELECT id, verification_request_id, full_name, date_of_birth, nationality,
             risk_level, match_found, matches, screened_at
      FROM public.aml_screenings`);

  const kyb = await optionalQuery<{
    id: string;
    business_session_id: string;
    key_person_id: string | null;
    subject_type: string;
    screened_name: string;
    risk_level: string | null;
    match_found: boolean;
    matches: unknown;
    screened_at: Date | string | null;
  }>(`SELECT id, business_session_id::text AS business_session_id, key_person_id,
             subject_type, screened_name, risk_level, match_found, matches, screened_at
      FROM public.business_aml_screenings`);

  const staff = await optionalQuery<{ id: string; email: string }>(
    `SELECT id::text AS id, email FROM aml.users WHERE email IS NOT NULL`,
  );

  const verifications = await optionalQuery<{ id: string; user_id: string | null; ocr_data: unknown }>(
    `SELECT vr.id, vr.user_id, COALESCE(vr.ocr_data, doc.ocr_data) AS ocr_data
     FROM public.verification_requests vr
     LEFT JOIN LATERAL (
       SELECT ocr_data FROM public.documents d
       WHERE d.verification_request_id = vr.id
       ORDER BY d.created_at ASC LIMIT 1
     ) doc ON true
     WHERE vr.status IN ('verified', 'approved')`,
  );
  const screens = await optionalQuery<{ reference: string; input_name: string }>(
    `SELECT reference, input_name FROM aml.screening_requests`,
  );
  const existingLinks = await optionalQuery<{ verification_id: string; screening_ref: string }>(
    `SELECT verification_id::text AS verification_id, screening_ref
     FROM compliance.subject_links
     WHERE verification_id IS NOT NULL AND screening_ref IS NOT NULL`,
  );

  const nameFrom = (ocr: unknown): string => {
    if (!ocr || typeof ocr !== 'object') return '';
    const rec = ocr as Record<string, unknown>;
    return String(rec.full_name || rec.name || '');
  };

  const planned: PlannedCopy[] = [
    ...planKabilaCopies(kabila),
    ...kyb.map((r) => ({ kind: 'kyb' as const, id: r.id, reference: kabilaScreenRef(r.id, 'KYB'), name: r.screened_name })),
    ...staff.map((s) => ({ kind: 'staff' as const, id: s.id, name: s.email })),
    ...planNameLinks({
      verifications: verifications.map((v) => ({ id: v.id, name: nameFrom(v.ocr_data) })),
      screenings: screens.map((s) => ({ reference: s.reference, name: s.input_name })),
      existing: existingLinks,
    }),
  ];

  const applied = { kabila: 0, kyb: 0, staff: 0, name_links: 0 };

  if (apply) {
    for (const row of kabila) {
      await mirrorKabilaScreening(row);
      applied.kabila += 1;
    }
    for (const row of kyb) {
      await mirrorKybScreening(row);
      applied.kyb += 1;
    }
    for (const s of staff) {
      const n = await optionalQuery(
        `INSERT INTO compliance.staff (
           email, full_name, aml_role, kyc_role, readonly, is_active, scopes, aml_user_id
         )
         SELECT lower(email), COALESCE(full_name, ''), COALESCE(role, 'analyst'),
                CASE WHEN lower(COALESCE(role,'')) IN ('superuser','admin') THEN 'admin' ELSE 'reviewer' END,
                lower(COALESCE(role,'')) = 'auditor', COALESCE(is_active, true),
                ARRAY['kyc','aml']::text[], id
         FROM aml.users WHERE id::text = $1
         ON CONFLICT (email) DO UPDATE SET
           aml_user_id = COALESCE(compliance.staff.aml_user_id, EXCLUDED.aml_user_id),
           updated_at = NOW()`,
        [s.id],
      );
      if (n) applied.staff += 1;
    }
    for (const link of planned.filter((p) => p.kind === 'name-link')) {
      const vr = verifications.find((v) => v.id === link.id);
      await linkSubject({
        verificationId: link.id,
        kycUserId: vr?.user_id,
        screeningRef: link.reference || '',
        fullName: link.name,
      });
      applied.name_links += 1;
    }
    await optionalQuery(
      `INSERT INTO compliance.migration_runs (phase, mode, report, passed, finished_at)
       VALUES ('4', 'apply', $1::jsonb, $2, NOW())`,
      [JSON.stringify({ applied, planned: planned.length }), null],
    );
  }

  const coverage = await coverageAttestation();
  if (apply) {
    await optionalQuery(
      `UPDATE compliance.migration_runs SET report = $1::jsonb, passed = $2
       WHERE id = (SELECT id FROM compliance.migration_runs ORDER BY started_at DESC LIMIT 1)`,
      [JSON.stringify({ applied, planned: planned.length, coverage }), coverage.passed],
    );
  }

  return {
    mode: apply ? 'apply' : 'dry-run',
    planned,
    applied,
    coverage,
  };
}

export { normalizeName };
