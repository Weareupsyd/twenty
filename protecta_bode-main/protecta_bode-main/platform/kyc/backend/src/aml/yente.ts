import { z } from 'zod';
import { SCHEMA_MAPPING, amlConfig } from './config.js';

export const ScreenRequestSchema = z.object({
  entity_type: z.enum(['auto', 'person', 'company', 'organization', 'vessel', 'aircraft']).default('auto'),
  name: z.string().min(2).max(512),
  country: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  aliases: z.array(z.string()).default([]),
  date_of_birth: z.string().optional().nullable(),
  nationality: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  id_number: z.string().optional().nullable(),
  registration_number: z.string().optional().nullable(),
  tax_number: z.string().optional().nullable(),
  incorporation_date: z.string().optional().nullable(),
  jurisdiction: z.string().optional().nullable(),
  threshold: z.number().min(0.5).max(1).default(0.82),
  include_relationships: z.boolean().default(true),
  include_source_documents: z.boolean().default(true),
  requested_by: z.string().optional().nullable(),
});

export type ScreenRequest = z.infer<typeof ScreenRequestSchema>;

export function schemasForEntityType(entityType: string): string[] {
  return SCHEMA_MAPPING[entityType] || SCHEMA_MAPPING.auto;
}

export function buildEntityProperties(payload: ScreenRequest): Record<string, string[]> {
  const properties: Record<string, string[]> = { name: [payload.name] };
  if (payload.aliases?.length) properties.alias = payload.aliases;
  if (payload.country) properties.country = [payload.country.toLowerCase()];
  if (payload.address) properties.address = [payload.address];
  if (payload.date_of_birth) properties.birthDate = [payload.date_of_birth];
  if (payload.nationality) properties.nationality = [payload.nationality.toLowerCase()];
  if (payload.gender) properties.gender = [payload.gender.toLowerCase()];
  if (payload.id_number) properties.idNumber = [payload.id_number];
  if (payload.registration_number) properties.registrationNumber = [payload.registration_number];
  if (payload.tax_number) properties.taxNumber = [payload.tax_number];
  if (payload.incorporation_date) properties.incorporationDate = [payload.incorporation_date];
  if (payload.jurisdiction) properties.jurisdiction = [payload.jurisdiction.toLowerCase()];
  return properties;
}

export function buildYenteRequest(payload: ScreenRequest): {
  queries: Record<string, { schema: string; properties: Record<string, string[]> }>;
  threshold: number;
  limit: number;
} {
  const properties = buildEntityProperties(payload);
  const queries: Record<string, { schema: string; properties: Record<string, string[]> }> = {};
  schemasForEntityType(payload.entity_type).forEach((schema, idx) => {
    queries[`q${idx}`] = { schema, properties };
  });
  return { queries, threshold: payload.threshold, limit: 25 };
}

export async function callYente(payload: ScreenRequest): Promise<Array<Record<string, unknown>>> {
  const body = buildYenteRequest(payload);
  const threshold = body.threshold;
  const limit = body.limit;
  const url = `${amlConfig.yenteUrl}/match/${amlConfig.yenteDataset}?threshold=${threshold}&limit=${limit}`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: body.queries }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new Error(`Could not connect to yente at ${url}. Is it running?`);
  }
  if (!resp.ok) {
    throw new Error(`yente returned ${resp.status}: ${await resp.text()}`);
  }
  const result = (await resp.json()) as { responses?: Record<string, { results?: Array<Record<string, unknown>> }> };
  const matches: Array<Record<string, unknown>> = [];
  for (const response of Object.values(result.responses || {})) {
    for (const match of response.results || []) {
      match.entity_type = match.schema || '';
      matches.push(match);
    }
  }
  return matches;
}

export async function getEntityDetails(entityId: string): Promise<Record<string, unknown>> {
  if (!entityId) return {};
  const url = `${amlConfig.yenteUrl}/entities/${encodeURIComponent(entityId)}?nested=true`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (resp.status === 404) return {};
    if (!resp.ok) return {};
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function searchYente(params: {
  q: string;
  schema?: string;
  country?: string;
  limit: number;
}): Promise<unknown> {
  const qs = new URLSearchParams({ q: params.q, limit: String(params.limit) });
  if (params.schema) qs.set('schema', params.schema);
  if (params.country) qs.set('countries', params.country);
  const url = `${amlConfig.yenteUrl}/search/${amlConfig.yenteDataset}?${qs}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) {
    const err = new Error(`yente search error: ${await resp.text()}`) as Error & { status?: number };
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

export async function pingYenteUpdate(): Promise<{ ok: boolean; detail: string }> {
  const url = `${amlConfig.yenteUrl}/updatez?token=${encodeURIComponent(amlConfig.yenteUpdateToken)}&sync=false`;
  try {
    const resp = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(15_000) });
    return { ok: resp.ok, detail: await resp.text() };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Indexed dataset version + entity count from yente's catalogue, if available. */
export async function getYenteDatasetStats(): Promise<{ version: string | null; entity_count: number | null }> {
  const empty = { version: null, entity_count: null };
  try {
    const resp = await fetch(`${amlConfig.yenteUrl}/catalog`, { signal: AbortSignal.timeout(5_000) });
    if (!resp.ok) return empty;
    const data = await resp.json() as {
      datasets?: Array<Record<string, unknown>>;
    };
    const datasets = Array.isArray(data.datasets) ? data.datasets : [];
    const ds = datasets.find((d) => d.name === amlConfig.yenteDataset) || datasets[0];
    if (!ds) return empty;
    const index = (ds.index && typeof ds.index === 'object') ? ds.index as Record<string, unknown> : {};
    const rawCount = ds.entity_count ?? index.entity_count ?? ds.things ?? index.things;
    const count = typeof rawCount === 'number' && Number.isFinite(rawCount) ? rawCount : null;
    const rawVersion = ds.index_version ?? ds.version ?? ds.updated_at ?? index.version ?? index.updated_at;
    const version = rawVersion != null && String(rawVersion).trim() ? String(rawVersion).slice(0, 64) : null;
    return { version, entity_count: count };
  } catch {
    return empty;
  }
}
