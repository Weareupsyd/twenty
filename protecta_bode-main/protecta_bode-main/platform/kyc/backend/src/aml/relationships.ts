import { extractRelationships } from './enrichment.js';
import { amlQuery } from './db.js';

export async function collectRelationships(
  matches: Array<Record<string, unknown>>,
  entityId = '',
): Promise<Array<Record<string, unknown>>> {
  const relationships: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const nested = (match._nested as Record<string, unknown>) || match;
    const linked = extractRelationships(nested);
    const subjectName = String(nested.caption || match.caption || match.id || '');
    const subjectId = String(nested.id || match.id || '');
    for (const rel of linked) {
      rel.person = rel.person || subjectName;
      rel.subject_id = rel.subject_id || subjectId;
      const key = [subjectId, rel.relationship_type, rel.entity_name, rel.entity_id].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      relationships.push(rel);
    }
  }

  if (entityId) {
    try {
      const { rows } = await amlQuery<{
        source_entity_id: string;
        target_entity_id: string;
        relationship_type: string;
        provenance: string;
      }>(
        `SELECT source_entity_id, target_entity_id, relationship_type, provenance
         FROM aml.local_relationships
         WHERE source_entity_id = $1 OR target_entity_id = $1`,
        [entityId],
      );
      for (const row of rows) {
        const other = row.source_entity_id === entityId ? row.target_entity_id : row.source_entity_id;
        relationships.push({
          relationship_type: row.relationship_type,
          entity_id: other,
          entity_name: '',
          risk_categories: [],
          source: `confirmed local record (${row.provenance})`,
        });
      }
    } catch {
      // enrichment must never break screening
    }
  }
  return relationships;
}
