import { randomUUID } from 'crypto';
import { amlQuery } from './db.js';

export function generateReference(prefix = 'SCR'): string {
  const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${prefix}-${ts}-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

export async function logScreening(row: {
  reference: string;
  requestType: string;
  inputName: string;
  inputPayload: unknown;
  yenteResult: unknown;
  riskLevel: string;
  matchClassification: unknown;
  matchFound: boolean;
  maxScore: number;
  processingMs: number;
  requestedBy?: string | null;
}): Promise<void> {
  try {
    await amlQuery(
      `INSERT INTO aml.screening_requests (
         reference, request_type, status, input_name, input_payload,
         yente_result, risk_level, match_classification, match_found,
         max_score, processing_ms, requested_by, created_at
       ) VALUES (
         $1, $2, 'completed', $3, $4::jsonb, $5::jsonb, $6, $7::jsonb,
         $8, $9, $10, $11, NOW()
       )`,
      [
        row.reference,
        row.requestType,
        row.inputName,
        JSON.stringify(row.inputPayload),
        JSON.stringify(row.yenteResult ?? {}),
        row.riskLevel,
        JSON.stringify(row.matchClassification),
        row.matchFound,
        row.maxScore,
        row.processingMs,
        row.requestedBy ?? null,
      ],
    );
  } catch (err) {
    console.error(`[audit] Failed to log screening ${row.reference}:`, err);
  }
}

export async function getDataFreshness(): Promise<{
  dataset_version: string | null;
  last_successful_sync: Date | string | null;
  entity_count?: number;
}> {
  try {
    const { rows } = await amlQuery<{
      dataset_version: string | null;
      completed_at: Date;
      entity_count: number;
    }>(
      `SELECT dataset_version, completed_at, entity_count
       FROM aml.dataset_syncs
       WHERE status = 'succeeded'
       ORDER BY completed_at DESC LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return { dataset_version: null, last_successful_sync: null };
    let datasetVersion = row.dataset_version;
    let entityCount = row.entity_count;
    if (!datasetVersion || !entityCount) {
      try {
        const { listDatasets } = await import('./datasets.js');
        const latest = (await listDatasets())[0];
        if (!datasetVersion && typeof latest?.dataset_version === 'string') datasetVersion = latest.dataset_version;
        if (!entityCount && typeof latest?.entity_count === 'number') entityCount = latest.entity_count;
      } catch {
        // listing is best-effort enrichment
      }
    }
    return {
      dataset_version: datasetVersion,
      last_successful_sync: row.completed_at,
      entity_count: entityCount,
    };
  } catch {
    return { dataset_version: null, last_successful_sync: null };
  }
}
