import { randomUUID } from 'crypto';
import { amlQuery } from './db.js';

export async function createCase(payload: {
  title: string;
  description?: string | null;
  screening_reference?: string | null;
  created_by?: string | null;
}): Promise<Record<string, unknown>> {
  if (payload.screening_reference) {
    const found = await amlQuery(
      'SELECT reference FROM aml.screening_requests WHERE reference = $1',
      [payload.screening_reference],
    );
    if (!found.rows.length) {
      const err = new Error(`Screening reference ${payload.screening_reference} not found`) as Error & { status?: number };
      err.status = 400;
      throw err;
    }
  }
  const id = randomUUID();
  await amlQuery(
    `INSERT INTO aml.cases (id, title, description, status, screening_reference, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'open', $4, $5, NOW(), NOW())`,
    [id, payload.title, payload.description ?? null, payload.screening_reference ?? null, payload.created_by ?? null],
  );
  const created = await getCase(id);
  if (!created) throw new Error('Case insert failed');
  return created;
}

export async function listCases(status?: string): Promise<Array<Record<string, unknown>>> {
  const params: unknown[] = [];
  const where = status ? (params.push(status), 'WHERE c.status = $1') : '';
  const { rows } = await amlQuery(
    `SELECT c.id, c.title, c.description, c.status, c.screening_reference,
            c.created_by, c.created_at, c.updated_at,
            COALESCE(json_agg(
              json_build_object('id', n.id, 'case_id', n.case_id, 'content', n.content,
                                'author', n.author, 'created_at', n.created_at)
            ) FILTER (WHERE n.id IS NOT NULL), '[]') AS notes
     FROM aml.cases c
     LEFT JOIN aml.case_notes n ON n.case_id = c.id
     ${where}
     GROUP BY c.id
     ORDER BY c.updated_at DESC`,
    params,
  );
  return rows.map(rowToCase);
}

export async function getCase(caseId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await amlQuery(
    `SELECT c.id, c.title, c.description, c.status, c.screening_reference,
            c.created_by, c.created_at, c.updated_at,
            COALESCE(json_agg(
              json_build_object('id', n.id, 'case_id', n.case_id, 'content', n.content,
                                'author', n.author, 'created_at', n.created_at)
            ) FILTER (WHERE n.id IS NOT NULL), '[]') AS notes
     FROM aml.cases c
     LEFT JOIN aml.case_notes n ON n.case_id = c.id
     WHERE c.id = $1
     GROUP BY c.id`,
    [caseId],
  );
  return rows[0] ? rowToCase(rows[0]) : null;
}

export async function updateCaseStatus(caseId: string, status: string): Promise<Record<string, unknown>> {
  const allowed = new Set(['open', 'in_progress', 'closed']);
  if (!allowed.has(status)) {
    const err = new Error('status must be open, in_progress, or closed') as Error & { status?: number };
    err.status = 422;
    throw err;
  }
  // Fetch previous status for webhook diff
  const prev = await amlQuery<{ status: string }>('SELECT status FROM aml.cases WHERE id = $1', [caseId]);
  const previousStatus = prev.rows[0]?.status || null;

  const { rows } = await amlQuery(
    `UPDATE aml.cases SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING id`,
    [caseId, status],
  );
  if (!rows[0]) {
    const err = new Error('Case not found') as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  const updated = await getCase(caseId);
  if (!updated) throw new Error('Case update failed');

  // Fire-and-forget AML webhook for case status change (never blocks)
  try {
    const { fireAmlCaseStatusChanged } = await import('./webhooks.js');
    fireAmlCaseStatusChanged({ case_id: caseId, status, previous_status: previousStatus });
  } catch {
    // webhook dispatch must never break case update
  }

  return updated;
}

export async function addNote(caseId: string, content: string, author = 'api-user'): Promise<Record<string, unknown>> {
  const id = randomUUID();
  const { rows } = await amlQuery(
    `INSERT INTO aml.case_notes (id, case_id, content, author, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING id, case_id, content, author, created_at`,
    [id, caseId, content, author],
  );
  if (!rows[0]) {
    const err = new Error('Case not found') as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  return rows[0];
}

function rowToCase(row: Record<string, unknown>): Record<string, unknown> {
  let notes = row.notes;
  if (typeof notes === 'string') {
    try { notes = JSON.parse(notes); } catch { notes = []; }
  }
  return { ...row, notes: notes || [] };
}
