import { searchYente, getEntityDetails } from './yente.js';
import { curateProperties, extractRelationships, extractSanctions } from './enrichment.js';
import { collectRelationships } from './relationships.js';
import { amlConfig } from './config.js';

export async function entitySearch(q: string, opts: { schema?: string; country?: string; limit: number }): Promise<unknown> {
  return searchYente({ q, schema: opts.schema, country: opts.country, limit: opts.limit });
}

export async function entityDetail(entityId: string): Promise<Record<string, unknown>> {
  const url = `${amlConfig.yenteUrl}/entities/${encodeURIComponent(entityId)}?nested=true`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (resp.status === 404) {
    const err = new Error('Entity not found') as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  if (!resp.ok) {
    const err = new Error(`yente entity error: ${await resp.text()}`) as Error & { status?: number };
    err.status = resp.status;
    throw err;
  }
  const result = (await resp.json()) as Record<string, unknown>;
  const props = (result.properties as Record<string, unknown>) || {};
  result.details = curateProperties(result);
  result.sanctions = extractSanctions(result);
  result.relationships = extractRelationships(result);
  result.descriptions = props.notes || props.description || [];
  result.topics = result.topics || props.topics || [];
  return result;
}

export async function entityNetwork(entityId: string): Promise<Record<string, unknown>> {
  const entity = await getEntityDetails(entityId);
  if (!entity || !Object.keys(entity).length) {
    const err = new Error('Entity not found') as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  const nested = extractRelationships(entity);
  const local = await collectRelationships([], entityId);
  const seen = new Set<string>();
  const combined: Array<Record<string, unknown>> = [];
  for (const rel of [...nested, ...local]) {
    const key = [rel.relationship_type, rel.relationship_subtype, rel.entity_name, rel.entity_id].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(rel);
  }
  const props = (entity.properties as Record<string, unknown>) || {};
  return {
    entity_id: entityId,
    caption: entity.caption || '',
    schema: entity.schema || '',
    datasets: entity.datasets || [],
    topics: entity.topics || props.topics || [],
    details: curateProperties(entity),
    sanctions: extractSanctions(entity),
    descriptions: props.notes || props.description || [],
    relationships: combined,
    network_version: 'phase2-typescript',
  };
}
