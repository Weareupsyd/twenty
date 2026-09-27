import { cquery, optionalQuery } from './query.js';
import { normalizeDecision, type DecisionKind } from './shape.js';
import { getSubjectFile } from './subjects.js';
import type { StaffPrincipal } from './staffAuth.js';

export async function recordSubjectDecision(opts: {
  subjectId: string;
  decision: string;
  reason?: string | null;
  escalateTo?: string | null;
  evidence?: Record<string, unknown>;
  staff: StaffPrincipal;
}): Promise<Record<string, unknown>> {
  const decision: DecisionKind = normalizeDecision(opts.decision);
  const file = await getSubjectFile(opts.subjectId);
  if (!file) {
    throw Object.assign(new Error('Subject not found'), { status: 404 });
  }
  if (opts.staff.readonly) {
    throw Object.assign(new Error('Auditor accounts are read-only'), { status: 403 });
  }

  const verificationId = (file.verification as { id?: string | null })?.id || null;
  const screeningRef = (file.screening as { reference?: string | null })?.reference || null;
  const evidence = {
    ...(opts.evidence || {}),
    escalate_to: opts.escalateTo || null,
    subject_ref: file.ref,
  };

  const inserted = await optionalQuery<{
    id: string;
    decision: string;
    reason: string | null;
    created_at: Date;
  }>(
    `INSERT INTO compliance.decisions (
       subject_id, verification_id, screening_ref, decision, reason, decided_by, evidence
     ) VALUES ($1, $2, $3, $4, $5, $6::uuid, $7::jsonb)
     RETURNING id, decision, reason, created_at`,
    [
      String(file.id),
      verificationId,
      screeningRef,
      decision,
      opts.reason || null,
      isUuidLike(opts.staff.id) ? opts.staff.id : null,
      JSON.stringify(evidence),
    ],
  );

  const row = inserted[0];
  if (!row) {
    // staff.id may not be a uuid when the token was minted from admin_users only
    const fallback = await cquery<{ id: string; decision: string; reason: string | null; created_at: Date }>(
      `INSERT INTO compliance.decisions (
         subject_id, verification_id, screening_ref, decision, reason, decided_by, evidence
       ) VALUES ($1, $2, $3, $4, $5, NULL, $6::jsonb)
       RETURNING id, decision, reason, created_at`,
      [String(file.id), verificationId, screeningRef, decision, opts.reason || null, JSON.stringify(evidence)],
    );
    if (!fallback.rows[0]) {
      throw Object.assign(new Error('Failed to record decision'), { status: 500 });
    }
  }

  if (verificationId && (decision === 'approve' || decision === 'reject')) {
    const status = decision === 'approve' ? 'verified' : 'failed';
    await optionalQuery(
      `UPDATE public.verification_requests
       SET status = $2, manual_review_reason = $3, updated_at = NOW()
       WHERE id = $1`,
      [verificationId, status, opts.reason || null],
    );
  }

  const updated = await getSubjectFile(String(file.id));
  return updated || file;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
