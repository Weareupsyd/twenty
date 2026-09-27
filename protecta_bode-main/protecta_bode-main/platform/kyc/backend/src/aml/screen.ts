import { riskCategoriesFromTopics, riskLevelForMatches, summaryFromMatches } from './risk.js';
import { callYente, getEntityDetails, type ScreenRequest } from './yente.js';
import { curateProperties, enrichMatch, extractPositions, extractRelationships, extractSanctions } from './enrichment.js';
import { collectRelationships } from './relationships.js';
import { generateReference, getDataFreshness, logScreening } from './audit.js';
import { effectiveThreshold, loadSettings } from './settings.js';

const MAX_ENRICH = 10;

function firstValue(values: unknown): string {
  if (!values) return '';
  if (typeof values === 'string') return values;
  if (Array.isArray(values)) {
    for (const v of values) {
      if (v !== null && v !== undefined && v !== '') return String(v);
    }
  }
  return '';
}

export function formatMatch(match: Record<string, unknown>): Record<string, unknown> {
  const props = (match.properties as Record<string, unknown>) || {};
  const nested = (match._nested as Record<string, unknown>) || {};
  const nestedProps = (nested.properties as Record<string, unknown>) || {};
  const entityId = String(match.id || match.entity_id || '');
  const topics = match.topics || nestedProps.topics || [];
  const datasets = (match.datasets as unknown[]) || [];
  const sourceLinks: Array<{ source: string; url: string }> = [];
  if (entityId) {
    sourceLinks.push({ source: 'OpenSanctions record', url: `https://www.opensanctions.org/entities/${entityId}/` });
  }
  const seen = new Set(sourceLinks.map((s) => s.source));
  for (const src of datasets) {
    const name = String(src);
    if (!seen.has(name)) {
      seen.add(name);
      sourceLinks.push({ source: name, url: '' });
    }
  }
  const nestedRels = Object.keys(nested).length ? extractRelationships(nested) : [];
  return {
    entity_id: entityId,
    entity_type: match.entity_type || match.schema || '',
    caption: nested.caption || match.caption || '',
    score: Math.round(Number(match.score || 0) * 10000) / 10000,
    risk_categories: riskCategoriesFromTopics(topics),
    datasets,
    identifiers: {
      registration_number: props.registrationNumber || [],
      tax_number: props.taxNumber || [],
      id_number: props.idNumber || [],
    },
    countries: props.country || nestedProps.country || [],
    addresses: props.address || nestedProps.address || [],
    source_links: sourceLinks,
    match_explanation: null,
    topics,
    aliases: nestedProps.alias || props.alias || [],
    birth_dates: nestedProps.birthDate || props.birthDate || [],
    birth_place: nestedProps.birthPlace || props.birthPlace || [],
    gender: nestedProps.gender || props.gender || [],
    positions: Object.keys(nested).length ? extractPositions(nested) : [],
    nationalities: nestedProps.nationality || props.nationality || [],
    citizenships: nestedProps.citizenship || props.citizenship || [],
    classification: nestedProps.classification || props.classification || [],
    political: nestedProps.political || props.political || [],
    education: nestedProps.education || props.education || [],
    emails: nestedProps.email || [],
    phones: nestedProps.phone || [],
    wikidata_id: nestedProps.wikidataId || props.wikidataId || '',
    wikipedia_url: nestedProps.wikipediaUrl || props.wikipediaUrl || '',
    source_url: nestedProps.sourceUrl || props.sourceUrl || '',
    first_seen: nested.first_seen || match.first_seen || '',
    last_seen: nested.last_seen || match.last_seen || '',
    last_change: nested.last_change || match.last_change || '',
    sanctions: Object.keys(nested).length ? extractSanctions(nested) : [],
    details: Object.keys(nested).length ? curateProperties(nested) : {},
    descriptions: nestedProps.notes || nestedProps.description || nestedProps.summary || [],
    relationships: nestedRels,
  };
}

async function enrichMatches(matches: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  if (!matches.length) return [];
  const ranked = [...matches].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < ranked.length; i += 1) {
    const m = ranked[i];
    if (m._nested || i >= MAX_ENRICH) {
      out.push(m);
      continue;
    }
    const eid = String(m.id || m.entity_id || '');
    const details = eid ? await getEntityDetails(eid) : {};
    out.push(enrichMatch(m, details));
  }
  return out;
}

export async function runScreen(payload: ScreenRequest): Promise<Record<string, unknown>> {
  const reference = generateReference('SCR');
  const start = Date.now();
  const matches = await callYente(payload);
  const settings = await loadSettings();
  const flagThreshold = effectiveThreshold(settings, payload.country, 0.82);
  const riskLevel = riskLevelForMatches(
    matches.map((m) => ({ score: Number(m.score || 0), topics: m.topics })),
    flagThreshold,
  );
  const summary = summaryFromMatches(
    matches.map((m) => ({ score: Number(m.score || 0), topics: m.topics })),
    riskLevel,
  );
  const enriched = await enrichMatches(matches);
  const relationships = payload.include_relationships && enriched.length
    ? await collectRelationships(enriched)
    : [];
  const elapsed = Date.now() - start;
  const maxScore = matches.reduce((m, x) => Math.max(m, Number(x.score || 0)), 0);
  await logScreening({
    reference,
    requestType: payload.entity_type,
    inputName: payload.name,
    inputPayload: payload,
    yenteResult: { matches: enriched, relationships },
    riskLevel,
    matchClassification: {
      sanctions: summary.sanctions_matches > 0,
      pep_related: summary.pep_related_matches > 0,
    },
    matchFound: summary.match_found,
    maxScore,
    processingMs: elapsed,
    requestedBy: payload.requested_by,
  });

  // Fire-and-forget AML webhook (staff-owned) - never blocks screening response
  try {
    const { fireAmlScreeningCompleted } = await import('./webhooks.js');
    fireAmlScreeningCompleted({
      reference,
      input_name: payload.name,
      risk_level: riskLevel,
      match_found: summary.match_found,
      max_score: maxScore,
    });
  } catch {
    // webhook dispatch must never break screening
  }

  return {
    reference,
    status: 'completed',
    query: {
      entity_type: payload.entity_type,
      name: payload.name,
      country: payload.country ?? null,
      registration_number: payload.registration_number ?? null,
    },
    summary,
    matches: enriched.map(formatMatch),
    relationships,
    data_freshness: await getDataFreshness(),
    analyst_note: 'Automated screening result. Identity and relationship findings require analyst verification.',
    timestamp: new Date().toISOString(),
  };
}

export async function getScreen(reference: string): Promise<Record<string, unknown> | null> {
  const { rows } = await amlQueryRow(reference);
  const row = rows[0];
  if (!row) return null;
  const payload = parseJson(row.input_payload);
  const yenteData = parseJson(row.yente_result);
  const storedRels = Array.isArray(yenteData.relationships) ? yenteData.relationships as Array<Record<string, unknown>> : [];
  const matches = Array.isArray(yenteData.matches) ? yenteData.matches as Array<Record<string, unknown>> : [];
  const classification = parseJson(row.match_classification);
  const highRisk = row.risk_level === 'High' || row.risk_level === 'Critical';
  const requiresReview = highRisk || Boolean(classification.sanctions);
  const summary = {
    match_found: row.match_found,
    risk_level: row.risk_level,
    requires_human_review: requiresReview,
    total_matches: matches.length,
    sanctions_matches: matches.filter((m) => riskCategoriesFromTopics(m.topics || m.risk_categories || []).includes('sanction')).length,
    pep_related_matches: matches.filter((m) => riskCategoriesFromTopics(m.topics || m.risk_categories || []).includes('pep')).length,
  };
  const enriched = await enrichMatches(matches);
  const relationships = storedRels.length ? storedRels : await collectRelationships(enriched);
  return {
    reference: row.reference,
    status: row.status,
    query: {
      entity_type: payload.entity_type || row.request_type || 'auto',
      name: payload.name || row.input_name || '',
      country: payload.country ?? null,
      registration_number: payload.registration_number ?? null,
      date_of_birth: payload.date_of_birth ?? null,
      nationality: payload.nationality ?? null,
      gender: payload.gender ?? null,
      id_number: payload.id_number ?? null,
      tax_number: payload.tax_number ?? null,
      jurisdiction: payload.jurisdiction ?? null,
      address: payload.address ?? null,
      aliases: payload.aliases || [],
      threshold: payload.threshold ?? 0.82,
      include_relationships: payload.include_relationships !== false,
    },
    summary,
    matches: enriched.map(formatMatch),
    relationships,
    data_freshness: await getDataFreshness(),
    processing_ms: row.processing_ms ?? null,
    requested_by: row.requested_by ?? null,
    max_score: row.max_score ?? null,
    analyst_note: 'Automated screening result. Identity and relationship findings require analyst verification.',
    timestamp: row.created_at,
  };
}

async function amlQueryRow(reference: string) {
  const { amlQuery } = await import('./db.js');
  return amlQuery<{
    reference: string;
    status: string;
    request_type: string;
    input_name: string;
    input_payload: unknown;
    yente_result: unknown;
    risk_level: string;
    match_classification: unknown;
    match_found: boolean;
    created_at: Date;
    processing_ms: number | null;
    requested_by: string | null;
    max_score: number | null;
  }>(
    `SELECT reference, status, request_type, input_name, input_payload, yente_result, risk_level,
            match_classification, match_found, created_at, processing_ms, requested_by, max_score
     FROM aml.screening_requests WHERE reference = $1`,
    [reference],
  );
}

function parseJson(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  if (typeof value === 'object') return value as Record<string, unknown>;
  return {};
}

export async function listScreenings(opts: {
  status?: string;
  type?: string;
  limit: number;
  offset: number;
}): Promise<{ total: number; items: Array<Record<string, unknown>> }> {
  const { amlQuery } = await import('./db.js');
  const cond: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    const s = opts.status.toLowerCase();
    if (s === 'clear') cond.push("risk_level = 'Clear'");
    else if (s === 'hit') cond.push('match_found = TRUE');
    else if (s === 'needs_edd') cond.push("risk_level IN ('High', 'Critical')");
  }
  if (opts.type) {
    params.push(opts.type);
    cond.push(`request_type = $${params.length}`);
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const count = await amlQuery<{ total: string }>(`SELECT COUNT(*)::text AS total FROM aml.screening_requests ${where}`, params);
  params.push(opts.limit, opts.offset);
  const { rows } = await amlQuery<{
    reference: string;
    input_name: string;
    request_type: string;
    risk_level: string;
    match_found: boolean;
    max_score: number;
    created_at: Date;
    requested_by: string | null;
  }>(
    `SELECT reference, input_name, request_type, risk_level, match_found, max_score, created_at, requested_by
     FROM aml.screening_requests ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const items = rows.map((row) => {
    let status = 'Clear';
    if (row.risk_level === 'High' || row.risk_level === 'Critical') status = 'Needs EDD';
    else if (row.match_found) status = 'Hit';
    return {
      reference: row.reference,
      name: row.input_name,
      entity_type: row.request_type,
      risk_level: row.risk_level,
      status,
      match_found: row.match_found,
      max_score: row.max_score,
      created_at: row.created_at,
      requested_by: row.requested_by,
    };
  });
  return { total: Number(count.rows[0]?.total || 0), items };
}

export async function runBulkScreen(
  entities: ScreenRequest[],
  threshold?: number,
): Promise<{ job_status: 'completed'; results: Array<Record<string, unknown>> }> {
  const { generateReference, logScreening } = await import('./audit.js');
  const results: Array<Record<string, unknown>> = [];
  for (const entity of entities) {
    if (threshold !== undefined) entity.threshold = threshold;
    const start = Date.now();
    try {
      const matches = await callYente(entity);
      const risk = riskLevelForMatches(matches.map((m) => ({ score: Number(m.score || 0), topics: m.topics })));
      const maxScore = Math.round(matches.reduce((m, x) => Math.max(m, Number(x.score || 0)), 0) * 10000) / 10000;
      const reference = generateReference('SCR');
      await logScreening({
        reference,
        requestType: entity.entity_type,
        inputName: entity.name,
        inputPayload: entity,
        yenteResult: { matches },
        riskLevel: risk,
        matchClassification: {
          sanctions: matches.some((m) => riskCategoriesFromTopics(m.topics).includes('sanction')),
          pep_related: matches.some((m) => riskCategoriesFromTopics(m.topics).includes('pep')),
        },
        matchFound: matches.length > 0,
        maxScore,
        processingMs: Date.now() - start,
        requestedBy: entity.requested_by,
      });

      // Fire-and-forget AML webhook for bulk screening
      try {
        const { fireAmlScreeningCompleted } = await import('./webhooks.js');
        fireAmlScreeningCompleted({
          reference,
          input_name: entity.name,
          risk_level: risk,
          match_found: matches.length > 0,
          max_score: maxScore,
        });
      } catch {
        // never break bulk
      }

      results.push({
        reference,
        name: entity.name,
        entity_type: entity.entity_type,
        risk_level: risk,
        match_found: matches.length > 0,
        max_score: maxScore,
        matches: matches.map(formatMatch),
      });
    } catch (e) {
      results.push({
        name: entity.name,
        entity_type: entity.entity_type,
        risk_level: 'Error',
        match_found: false,
        max_score: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { job_status: 'completed', results };
}

export { firstValue };
