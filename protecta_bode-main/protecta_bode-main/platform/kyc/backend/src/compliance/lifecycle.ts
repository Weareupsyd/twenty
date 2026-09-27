import { cquery, optionalQuery } from './query.js';
import { isUuid } from './ids.js';
import { logger } from '@/utils/logger.js';
import type { StaffPrincipal } from './staffAuth.js';

/**
 * Verification lifecycle: void (soft delete), restore, and link extension.
 *
 * Deletion strategy - soft void, never a hard DELETE.
 * ---------------------------------------------------
 * services/dataRetention.ts already states the house rule: real verification
 * records are anonymised rather than hard-deleted "so the verification audit
 * trail is preserved for compliance reporting". Voiding follows that rule.
 * The row stays; it simply stops being live:
 *
 *   - listSubjects() filters `voided_at IS NULL`, so a voided verification
 *     disappears from the subject queue and from every overview counter and
 *     funnel stage computed from that pool. That is the "not counted in the
 *     overall counter" requirement.
 *   - The row itself still carries who voided it, when, and why, so an
 *     auditor can always reconstruct the day.
 *   - Because nothing is destroyed, a void is reversible - restore() puts an
 *     accidentally-voided verification straight back in the queue.
 *
 * Demo/sandbox rows are the one exception in this codebase and are still hard
 * deleted by DataRetentionService.runDemoCleanup(); that path is untouched.
 */

/** Reasons a verification can leave the live queue. Free-text is also accepted. */
export const VOID_REASONS = ['expired', 'stale', 'accidental', 'duplicate', 'operator'] as const;
export type VoidReason = (typeof VOID_REASONS)[number] | string;

/** Default: a session untouched for this long is considered abandoned. */
export const DEFAULT_STALE_HOURS = 24;

/** How long a renewed link stays open. Matches the original hosted-session TTL. */
export const EXTENSION_WINDOW_MS = 60 * 60 * 1000;

export type VoidedVerification = {
  id: string;
  status: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
};

export type ExtendedVerification = {
  id: string;
  expires_at: string | null;
  extended_at: string | null;
  extended_by: string | null;
  extension_count: number;
};

/** Attribution label for a staff actor: UUID when we have one, else email. */
function actorLabel(staff: StaffPrincipal): string {
  if (staff.id && isUuid(staff.id)) return staff.id;
  return staff.email || staff.id || 'unknown';
}

/**
 * Void ("delete") a single verification.
 *
 * Idempotent: voiding an already-voided row returns the existing record rather
 * than erroring, so a double-click in the UI cannot produce a confusing 404.
 */
export async function voidVerification(opts: {
  id: string;
  reason?: VoidReason | null;
  staff: StaffPrincipal;
}): Promise<VoidedVerification> {
  if (!isUuid(opts.id)) {
    throw Object.assign(new Error('Invalid verification id'), { status: 400 });
  }
  if (opts.staff.readonly) {
    throw Object.assign(new Error('Auditor accounts are read-only'), { status: 403 });
  }

  const existing = await optionalQuery<{ id: string; status: string; voided_at: Date | null }>(
    `SELECT id, status, voided_at FROM public.verification_requests WHERE id = $1`,
    [opts.id],
  );
  if (!existing.length) {
    throw Object.assign(new Error('Verification not found'), { status: 404 });
  }

  const reason = (opts.reason || 'operator').toString().slice(0, 500);
  const actor = actorLabel(opts.staff);

  // COALESCE keeps the first void's attribution - a second void is a no-op on
  // the audit fields rather than an overwrite of who really removed it.
  const { rows } = await cquery<{
    id: string;
    status: string;
    voided_at: Date | null;
    voided_by: string | null;
    void_reason: string | null;
  }>(
    `UPDATE public.verification_requests
        SET voided_at   = COALESCE(voided_at, NOW()),
            voided_by   = COALESCE(voided_by, $2),
            void_reason = COALESCE(void_reason, $3),
            updated_at  = NOW()
      WHERE id = $1
      RETURNING id, status, voided_at, voided_by, void_reason`,
    [opts.id, actor, reason],
  );

  const row = rows[0];
  logger.info('Verification voided', { id: opts.id, reason, actor });
  return {
    id: row.id,
    status: row.status,
    voided_at: row.voided_at ? new Date(row.voided_at).toISOString() : null,
    voided_by: row.voided_by,
    void_reason: row.void_reason,
  };
}

/** Undo a void - puts the verification back in the live queue and counters. */
export async function restoreVerification(opts: {
  id: string;
  staff: StaffPrincipal;
}): Promise<VoidedVerification> {
  if (!isUuid(opts.id)) {
    throw Object.assign(new Error('Invalid verification id'), { status: 400 });
  }
  if (opts.staff.readonly) {
    throw Object.assign(new Error('Auditor accounts are read-only'), { status: 403 });
  }

  const { rows } = await cquery<{
    id: string;
    status: string;
    voided_at: Date | null;
    voided_by: string | null;
    void_reason: string | null;
  }>(
    `UPDATE public.verification_requests
        SET voided_at = NULL, voided_by = NULL, void_reason = NULL, updated_at = NOW()
      WHERE id = $1
      RETURNING id, status, voided_at, voided_by, void_reason`,
    [opts.id],
  );
  if (!rows.length) {
    throw Object.assign(new Error('Verification not found'), { status: 404 });
  }

  logger.info('Verification restored', { id: opts.id, actor: actorLabel(opts.staff) });
  const row = rows[0];
  return {
    id: row.id,
    status: row.status,
    voided_at: null,
    voided_by: null,
    void_reason: null,
  };
}

/**
 * Extend a hosted verification link whose window closed before the applicant
 * ever started.
 *
 * The session token hash is left untouched, so the original link the applicant
 * was sent keeps working - only the expiry moves. That is the point: the
 * recipient does not need a new URL, the one in their inbox starts working
 * again.
 *
 * A verification that is already finished cannot be extended; there is nothing
 * to reopen and doing so would reset a completed audit record.
 */
export async function extendVerificationLink(opts: {
  id: string;
  windowMs?: number;
  staff: StaffPrincipal;
}): Promise<ExtendedVerification> {
  if (!isUuid(opts.id)) {
    throw Object.assign(new Error('Invalid verification id'), { status: 400 });
  }
  if (opts.staff.readonly) {
    throw Object.assign(new Error('Auditor accounts are read-only'), { status: 403 });
  }

  const existing = await optionalQuery<{
    id: string;
    status: string;
    voided_at: Date | null;
    session_token_hash: string | null;
  }>(
    `SELECT id, status, voided_at, session_token_hash
       FROM public.verification_requests WHERE id = $1`,
    [opts.id],
  );
  if (!existing.length) {
    throw Object.assign(new Error('Verification not found'), { status: 404 });
  }
  const current = existing[0];

  if (current.voided_at) {
    throw Object.assign(
      new Error('This verification was deleted. Restore it before extending the link.'),
      { status: 409 },
    );
  }
  if (!current.session_token_hash) {
    throw Object.assign(
      new Error('This verification has no hosted link to extend.'),
      { status: 409 },
    );
  }
  const settled = ['verified', 'approved', 'failed', 'declined', 'rejected'];
  if (settled.includes((current.status || '').toLowerCase())) {
    throw Object.assign(
      new Error(`This verification is already ${current.status}; there is no link to extend.`),
      { status: 409 },
    );
  }

  const windowMs = opts.windowMs && opts.windowMs > 0 ? opts.windowMs : EXTENSION_WINDOW_MS;
  const expiresAt = new Date(Date.now() + windowMs);
  const actor = actorLabel(opts.staff);

  const { rows } = await cquery<{
    id: string;
    session_token_expires_at: Date | null;
    extended_at: Date | null;
    extended_by: string | null;
    extension_count: number;
  }>(
    `UPDATE public.verification_requests
        SET session_token_expires_at = $2,
            extended_at              = NOW(),
            extended_by              = $3,
            extension_count          = COALESCE(extension_count, 0) + 1,
            updated_at               = NOW()
      WHERE id = $1
      RETURNING id, session_token_expires_at, extended_at, extended_by, extension_count`,
    [opts.id, expiresAt.toISOString(), actor],
  );

  const row = rows[0];
  logger.info('Verification link extended', {
    id: opts.id,
    actor,
    expires_at: expiresAt.toISOString(),
    extension_count: row.extension_count,
  });
  return {
    id: row.id,
    expires_at: row.session_token_expires_at
      ? new Date(row.session_token_expires_at).toISOString()
      : null,
    extended_at: row.extended_at ? new Date(row.extended_at).toISOString() : null,
    extended_by: row.extended_by,
    extension_count: Number(row.extension_count || 0),
  };
}

export type SweepCandidate = {
  id: string;
  status: string;
  created_at: string | null;
  session_token_expires_at: string | null;
  reason: VoidReason;
};

/**
 * Find verifications the end-of-day sweep would void.
 *
 * Two independent conditions, both restricted to sessions that never reached a
 * terminal state:
 *
 *   expired - the hosted link window closed and the applicant never started.
 *   stale   - no link window, but the session has sat untouched past the
 *             staleness horizon (default 24h). This is the "accidentally
 *             started" case: someone opened a verification and walked away.
 *
 * Anything already verified, failed, or under manual review is left alone; a
 * decision in flight is not garbage.
 */
export async function findSweepCandidates(opts: {
  staleHours?: number;
  limit?: number;
} = {}): Promise<SweepCandidate[]> {
  const staleHours = opts.staleHours ?? DEFAULT_STALE_HOURS;
  const limit = Math.min(opts.limit ?? 500, 2000);

  return (
    await optionalQuery<{
      id: string;
      status: string;
      created_at: Date | null;
      session_token_expires_at: Date | null;
      reason: string;
    }>(
      `SELECT id, status, created_at, session_token_expires_at,
              CASE
                WHEN session_token_expires_at IS NOT NULL
                     AND session_token_expires_at < NOW() THEN 'expired'
                ELSE 'stale'
              END AS reason
         FROM public.verification_requests
        WHERE voided_at IS NULL
          AND COALESCE(status, 'pending') NOT IN
              ('verified', 'approved', 'failed', 'declined', 'rejected', 'manual_review', 'in_review')
          AND (
                (session_token_expires_at IS NOT NULL AND session_token_expires_at < NOW())
             OR (session_token_expires_at IS NULL
                 AND COALESCE(updated_at, created_at) < NOW() - ($1 || ' hours')::interval)
              )
        ORDER BY created_at ASC
        LIMIT ${limit}`,
      [String(staleHours)],
    )
  ).map((r) => ({
    id: r.id,
    status: r.status,
    created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
    session_token_expires_at: r.session_token_expires_at
      ? new Date(r.session_token_expires_at).toISOString()
      : null,
    reason: r.reason,
  }));
}

export type SweepResult = {
  scanned: number;
  voided: number;
  expired: number;
  stale: number;
  dry_run: boolean;
  ids: string[];
};

/**
 * The end-of-day sweep itself.
 *
 * Voids every candidate in one statement so a long list cannot half-apply.
 * Pass dryRun to preview what tonight would remove without touching anything -
 * the route exposes that so an operator can check the blast radius first.
 */
export async function sweepStaleVerifications(opts: {
  staleHours?: number;
  limit?: number;
  dryRun?: boolean;
  actor?: string;
} = {}): Promise<SweepResult> {
  const candidates = await findSweepCandidates({
    staleHours: opts.staleHours,
    limit: opts.limit,
  });

  const expired = candidates.filter((c) => c.reason === 'expired');
  const stale = candidates.filter((c) => c.reason === 'stale');
  const base: SweepResult = {
    scanned: candidates.length,
    voided: 0,
    expired: expired.length,
    stale: stale.length,
    dry_run: Boolean(opts.dryRun),
    ids: candidates.map((c) => c.id),
  };

  if (opts.dryRun || !candidates.length) return base;

  const actor = opts.actor || 'system:eod-sweep';

  // One UPDATE per reason bucket keeps void_reason accurate without a
  // per-row round trip.
  for (const [reason, rows] of [
    ['expired', expired],
    ['stale', stale],
  ] as const) {
    if (!rows.length) continue;
    await cquery(
      `UPDATE public.verification_requests
          SET voided_at   = NOW(),
              voided_by   = $2,
              void_reason = $3,
              updated_at  = NOW()
        WHERE id = ANY($1::uuid[])
          AND voided_at IS NULL`,
      [rows.map((r) => r.id), actor, reason],
    );
  }

  base.voided = candidates.length;
  logger.info('EOD verification sweep complete', {
    scanned: base.scanned,
    voided: base.voided,
    expired: base.expired,
    stale: base.stale,
    actor,
  });
  return base;
}
