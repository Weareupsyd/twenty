-- Allow webhook_deliveries to record BUSINESS session deliveries.
--
-- The table was built for person verifications: verification_request_id is
-- NOT NULL with an FK to verification_requests. A business session is not a
-- verification_request, so recording a KYB delivery would violate both the
-- null constraint and the foreign key.
--
-- Rather than fork the delivery log (which would split the audit trail and
-- the retry machinery), we relax the column and add a parallel one for
-- business sessions, with a CHECK that exactly one of them is set. Existing
-- person rows are untouched and every current insert still satisfies the
-- constraint.

ALTER TABLE webhook_deliveries
  ALTER COLUMN verification_request_id DROP NOT NULL;

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS business_session_id UUID
    REFERENCES business_sessions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_business
  ON webhook_deliveries(business_session_id);

-- Exactly one subject per delivery: a person verification OR a business
-- session, never both and never neither. Guards against an orphan delivery
-- row that belongs to nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'webhook_deliveries_subject_check'
  ) THEN
    ALTER TABLE webhook_deliveries
      ADD CONSTRAINT webhook_deliveries_subject_check CHECK (
        (verification_request_id IS NOT NULL AND business_session_id IS NULL)
        OR
        (verification_request_id IS NULL AND business_session_id IS NOT NULL)
      );
  END IF;
END $$;
