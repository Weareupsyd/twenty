import { asRecord, firstString, optionalQuery } from './query.js';
import { shortRef } from './ids.js';
import { planFanout, shapeMatch, toSummary, type FanoutTarget } from './shape.js';
import { runScreen } from '../aml/screen.js';
import { ScreenRequestSchema } from '../aml/yente.js';
import type { StaffPrincipal } from './staffAuth.js';

type SessionRow = {
  id: string;
  developer_id: string | null;
  legal_name: string | null;
  registration_number: string | null;
  jurisdiction: string | null;
  registered_address: string | null;
  incorporation_date: string | null;
  company_status: string | null;
  status: string;
  user_provided_data: unknown;
  registry_data: unknown;
  extracted_data: unknown;
  created_at: Date;
  updated_at: Date | null;
  session_number: string | null;
  workflow_id: string | null;
  decision_reason: string | null;
};

type PersonRow = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  nationality: string | null;
  role_tags: string[] | null;
  ownership_percentage: number | null;
  voting_percentage: number | null;
  is_corporate: boolean | null;
  kyc_status: string | null;
  source: string | null;
  linked_kyc_session_id: string | null;
};

export async function listBusinesses(opts: {
  q?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ total: number; items: Array<Record<string, unknown>> }> {
  const rows = await optionalQuery<SessionRow>(
    `SELECT id, developer_id, legal_name, registration_number, jurisdiction, registered_address,
            incorporation_date, company_status, status, user_provided_data, registry_data,
            extracted_data, created_at, updated_at, session_number, workflow_id, decision_reason
     FROM public.business_sessions
     WHERE parent_session_id IS NULL
     ORDER BY created_at DESC
     LIMIT 200`,
  );
  const people = await optionalQuery<{ business_session_id: string } & PersonRow>(
    `SELECT id, business_session_id, full_name, date_of_birth, nationality, role_tags,
            ownership_percentage, voting_percentage, is_corporate, kyc_status, source,
            linked_kyc_session_id
     FROM public.business_key_people`,
  );
  const ubos = await optionalQuery<{
    business_session_id: string;
    screening_ref: string | null;
    person_name: string;
  }>(
    `SELECT business_session_id, screening_ref, person_name FROM compliance.ubo_links`,
  );
  const screens = await optionalQuery<{
    reference: string;
    input_name: string;
    risk_level: string;
    match_found: boolean;
    max_score: number | null;
    yente_result: unknown;
  }>(
    `SELECT reference, input_name, risk_level, match_found, max_score, yente_result
     FROM aml.screening_requests ORDER BY created_at DESC LIMIT 400`,
  );
  const docs = await optionalQuery<{ business_session_id: string; document_type: string; status: string }>(
    `SELECT business_session_id, document_type, status FROM public.business_documents`,
  );

  const peopleBy = new Map<string, PersonRow[]>();
  for (const p of people) {
    const list = peopleBy.get(p.business_session_id) || [];
    list.push(p);
    peopleBy.set(p.business_session_id, list);
  }
  const screenByName = new Map(screens.map((s) => [s.input_name.toLowerCase(), s]));

  let items = rows.map((row) => {
    const provided = asRecord(row.user_provided_data);
    const name = row.legal_name || firstString(provided.legal_name) || 'Unnamed business';
    const companyScreen = screenByName.get(name.toLowerCase());
    const keyPeople = peopleBy.get(row.id) || [];
    const uboHits = keyPeople.filter((p) => {
      const s = screenByName.get(p.full_name.toLowerCase());
      return s && (s.match_found || s.risk_level === 'High' || s.risk_level === 'Critical');
    }).length;
    const sessionDocs = docs.filter((d) => d.business_session_id === row.id);
    const summary = toSummary({
      id: row.id,
      kind: 'business',
      name,
      country: row.jurisdiction || firstString(provided.jurisdiction) || null,
      verificationStatus: row.status,
      screeningRisk: companyScreen?.risk_level,
      matchFound: companyScreen?.match_found,
      maxScore: companyScreen?.max_score ?? null,
      submittedAt: row.created_at,
      screeningRef: companyScreen?.reference || null,
    });
    return {
      ...summary,
      session_number: row.session_number,
      registration_number: row.registration_number || firstString(provided.registration_number) || null,
      ubos: keyPeople.length,
      documents: `${sessionDocs.length}`,
      company_screen: summary.screening,
      ubo_screen: uboHits ? `${uboHits} hit${uboHits === 1 ? '' : 's'}` : (ubos.some((u) => u.business_session_id === row.id) ? 'clear' : 'not run'),
    };
  });

  if (opts.status && opts.status !== 'all') {
    const s = opts.status.toLowerCase();
    items = items.filter((i) => String(i.decision).toLowerCase() === s || String(i.verification).toLowerCase() === s);
  }
  if (opts.q) {
    const q = opts.q.toLowerCase();
    items = items.filter((i) =>
      String(i.name).toLowerCase().includes(q)
      || String(i.ref).toLowerCase().includes(q)
      || String(i.registration_number || '').toLowerCase().includes(q));
  }
  const total = items.length;
  const offset = opts.offset || 0;
  const limit = Math.min(opts.limit || 50, 200);
  return { total, items: items.slice(offset, offset + limit) };
}

export async function getBusinessFile(id: string): Promise<Record<string, unknown> | null> {
  const row = (await optionalQuery<SessionRow>(
    `SELECT id, developer_id, legal_name, registration_number, jurisdiction, registered_address,
            incorporation_date, company_status, status, user_provided_data, registry_data,
            extracted_data, created_at, updated_at, session_number, workflow_id, decision_reason
     FROM public.business_sessions WHERE id = $1`,
    [id],
  ))[0];
  if (!row) return null;

  const people = await optionalQuery<PersonRow>(
    `SELECT id, full_name, date_of_birth, nationality, role_tags, ownership_percentage,
            voting_percentage, is_corporate, kyc_status, source, linked_kyc_session_id
     FROM public.business_key_people WHERE business_session_id = $1
     ORDER BY created_at ASC`,
    [id],
  );
  const documents = await optionalQuery<{
    document_type: string;
    status: string;
    file_name: string | null;
    ocr_data: unknown;
    created_at: Date;
  }>(
    `SELECT document_type, status, file_name, ocr_data, created_at
     FROM public.business_documents WHERE business_session_id = $1`,
    [id],
  );
  const checks = await optionalQuery<{
    field_name: string;
    result: string;
    detail: string | null;
    values_by_source: unknown;
  }>(
    `SELECT field_name, result, detail, values_by_source
     FROM public.business_cross_checks WHERE business_session_id = $1`,
    [id],
  );
  const ubos = await optionalQuery<{
    id: string;
    person_name: string;
    role_tags: string[];
    ownership_pct: number | null;
    screening_ref: string | null;
  }>(
    `SELECT id, person_name, role_tags, ownership_pct, screening_ref
     FROM compliance.ubo_links WHERE business_session_id = $1`,
    [id],
  );
  const screens = await optionalQuery<{
    reference: string;
    input_name: string;
    risk_level: string;
    match_found: boolean;
    max_score: number | null;
    yente_result: unknown;
    created_at: Date;
  }>(
    `SELECT reference, input_name, risk_level, match_found, max_score, yente_result, created_at
     FROM aml.screening_requests
     WHERE input_name = ANY($1::text[])
     ORDER BY created_at DESC`,
    [[row.legal_name, ...people.map((p) => p.full_name)].filter(Boolean)],
  );

  const provided = asRecord(row.user_provided_data);
  const extracted = asRecord(row.extracted_data);
  const registry = asRecord(row.registry_data);
  const name = row.legal_name || firstString(provided.legal_name) || 'Unnamed business';
  const companyScreen = screens.find((s) => s.input_name.toLowerCase() === name.toLowerCase());

  const ownership = people.map((p) => {
    const screen = screens.find((s) => s.input_name.toLowerCase() === p.full_name.toLowerCase());
    const link = ubos.find((u) => u.person_name.toLowerCase() === p.full_name.toLowerCase());
    return {
      id: p.id,
      name: p.full_name,
      role_tags: p.role_tags || [],
      ownership_pct: p.ownership_percentage,
      voting_pct: p.voting_percentage,
      is_corporate: Boolean(p.is_corporate),
      kyc_status: p.kyc_status,
      source: p.source,
      screening: screen
        ? {
          reference: screen.reference,
          risk_level: screen.risk_level,
          match_found: screen.match_found,
          max_score: screen.max_score,
        }
        : (link?.screening_ref ? { reference: link.screening_ref } : null),
    };
  });

  return {
    id: row.id,
    ref: shortRef('BUS', row.id),
    kind: 'business',
    name,
    country: row.jurisdiction || firstString(provided.jurisdiction) || null,
    status: row.status,
    session_number: row.session_number,
    registration_number: row.registration_number || firstString(provided.registration_number) || null,
    submitted_at: row.created_at,
    workflow_id: row.workflow_id,
    company: {
      legal_name: name,
      registration_number: row.registration_number,
      jurisdiction: row.jurisdiction,
      registered_address: row.registered_address,
      incorporation_date: row.incorporation_date,
      status: row.company_status,
    },
    registry_cross_check: checks.map((c) => ({
      field: c.field_name,
      result: c.result,
      detail: c.detail,
      values: c.values_by_source,
    })),
    typed: provided,
    extracted,
    registry,
    ownership,
    documents: documents.map((d) => ({
      type: d.document_type,
      status: d.status,
      name: d.file_name,
      received: d.created_at,
    })),
    company_screening: companyScreen
      ? {
        reference: companyScreen.reference,
        risk_level: companyScreen.risk_level,
        match_found: companyScreen.match_found,
        max_score: companyScreen.max_score,
        matches: (asRecord(companyScreen.yente_result).matches as Array<Record<string, unknown>> || []).map((m) => shapeMatch(m)),
      }
      : null,
    ubo_links: ubos,
    decision_reason: row.decision_reason,
  };
}

export async function fanOutUbos(businessId: string, staff: StaffPrincipal): Promise<Record<string, unknown>> {
  const file = await getBusinessFile(businessId);
  if (!file) {
    throw Object.assign(new Error('Business session not found'), { status: 404 });
  }
  const session = {
    legal_name: String((file.company as { legal_name?: string }).legal_name || file.name),
    jurisdiction: (file.company as { jurisdiction?: string | null }).jurisdiction || null,
    user_provided_data: (file.typed as Record<string, unknown>) || {},
  };
  const people = ((file.ownership as Array<Record<string, unknown>>) || []).map((p) => ({
    id: String(p.id || ''),
    full_name: String(p.name || ''),
    date_of_birth: null,
    nationality: null,
    role_tags: (p.role_tags as string[]) || [],
    ownership_percentage: (p.ownership_pct as number | null) ?? null,
    is_corporate: Boolean(p.is_corporate),
  }));
  const targets: FanoutTarget[] = planFanout(session, people);
  const results: Array<Record<string, unknown>> = [];

  for (const target of targets) {
    let screeningRef: string | null = null;
    let riskLevel: string | null = null;
    let error: string | null = null;
    try {
      const screened = await runScreen(ScreenRequestSchema.parse({
        entity_type: target.kind === 'company' ? 'company' : 'person',
        name: target.name,
        country: target.country,
        date_of_birth: target.date_of_birth,
        requested_by: staff.email,
      }));
      screeningRef = String(screened.reference || '');
      riskLevel = String((screened.summary as { risk_level?: string })?.risk_level || '');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    if (target.kind === 'person' || target.key_person_id) {
      await optionalQuery(
        `INSERT INTO compliance.ubo_links (
           business_session_id, person_name, role_tags, ownership_pct, screening_ref
         ) VALUES ($1, $2, $3::text[], $4, $5)`,
        [businessId, target.name, target.role_tags, target.ownership_pct, screeningRef],
      );
    }
    await optionalQuery(
      `INSERT INTO compliance.subject_links (
         kyc_user_id, verification_id, screening_ref, full_name, date_of_birth, country, display_ref
       ) VALUES (NULL, $1, $2, $3, $4, $5, $6)`,
      [
        target.key_person_id && isUuid(target.key_person_id) ? null : null,
        screeningRef,
        target.name,
        target.date_of_birth,
        target.country,
        shortRef(target.kind === 'company' ? 'BUS' : 'SUB', screeningRef || target.name),
      ],
    );
    results.push({
      name: target.name,
      kind: target.kind,
      role_tags: target.role_tags,
      screening_ref: screeningRef,
      risk_level: riskLevel,
      error,
    });
  }

  return {
    business_id: businessId,
    ref: file.ref,
    targets: targets.length,
    results,
    file: await getBusinessFile(businessId),
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export { planFanout };
