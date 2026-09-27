-- ─────────────────────────────────────────────────
-- Verification lifecycle: void (soft delete) + link extension
-- ─────────────────────────────────────────────────
-- Adds the columns behind three operator-facing capabilities:
--
--   1. Delete button - a stale, expired or accidentally-started verification
--      can be removed from the working queue and from the overview counters.
--   2. EOD sweep - a scheduled job voids abandoned sessions in bulk each night.
--   3. Extend link - a hosted verification link that expired before the
--      applicant ever opened it can be given a fresh window.
--
-- Deletion strategy follows the house rule already documented in
-- services/dataRetention.ts: real (non-demo) verification records are NEVER
-- hard-deleted, because an AML audit trail must still be able to answer
-- "what happened to subject X on date Y". "Delete" is therefore a soft void:
-- the row survives, stops counting, and carries who/when/why.
--
-- voided_at     - NULL means live. Non-NULL removes the row from
--                 listSubjects(), and therefore from every overview counter
--                 and funnel stage derived from it.
-- voided_by     - TEXT, not a UUID FK: the actor may be a staff UUID, an
--                 operator email, or the literal 'system:eod-sweep' when the
--                 scheduled job did it. Same free-form convention as
--                 verification_requests.reviewed_by.
-- void_reason   - short machine-ish label: 'expired', 'stale', 'accidental',
--                 'duplicate', 'operator'. Kept free-text so the UI can pass
--                 an operator note without a schema change.
-- extended_at / extended_by / extension_count
--               - audit for link renewals, so an auditor can see that a
--                 window was reopened, by whom, and how many times.
--
-- All columns nullable / defaulted -> metadata-only ALTER, no table rewrite.
-- Existing rows stay live (voided_at NULL), so no backfill and no behaviour
-- change until an operator or the sweep acts.
-- ─────────────────────────────────────────────────

ALTER TABLE verification_requests
  ADD COLUMN IF NOT EXISTS voided_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by       TEXT,
  ADD COLUMN IF NOT EXISTS void_reason     TEXT,
  ADD COLUMN IF NOT EXISTS extended_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extended_by     TEXT,
  ADD COLUMN IF NOT EXISTS extension_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN verification_requests.voided_at IS
  'Soft delete. NULL = live. Non-NULL excludes the row from subject lists and overview counters while preserving the audit trail.';
COMMENT ON COLUMN verification_requests.voided_by IS
  'Who voided it: staff UUID, operator email, or ''system:eod-sweep'' for the scheduled end-of-day job.';
COMMENT ON COLUMN verification_requests.void_reason IS
  'Why it was voided: expired | stale | accidental | duplicate | operator, or a free-text operator note.';
COMMENT ON COLUMN verification_requests.extended_at IS
  'When the hosted session link was last given a fresh expiry window. NULL if never extended.';
COMMENT ON COLUMN verification_requests.extended_by IS
  'Who extended the link: staff UUID or operator email.';
COMMENT ON COLUMN verification_requests.extension_count IS
  'How many times the link window has been reopened. Lets policy cap runaway renewals.';

-- The hot path is "live rows only": every subject list and counter filters on
-- voided_at IS NULL. A partial index keeps that filter cheap and stays small,
-- because it only indexes the live rows.
CREATE INDEX IF NOT EXISTS idx_verification_requests_live
  ON verification_requests (created_at DESC)
  WHERE voided_at IS NULL;

-- The EOD sweep scans for live sessions whose token window has closed.
-- session_token_expires_at is added by 54_add_session_token.sql, but sorted
-- order puts this "2026..." file BEFORE "54_...". Ensure the column exists
-- defensively (54 uses ADD COLUMN IF NOT EXISTS, so this is a no-op once 54
-- has run) so the sweep index is created on every install.
ALTER TABLE verification_requests
  ADD COLUMN IF NOT EXISTS session_token_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_verification_requests_sweep
  ON verification_requests (session_token_expires_at)
  WHERE voided_at IS NULL;
