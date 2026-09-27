-- Allow webhook_deliveries to record AML / staff-owned webhook deliveries.
--
-- Migration 62 added business_session_id and a CHECK that exactly one of
-- verification_request_id / business_session_id is set. That works for
-- person verifications and KYB, but AML staff webhooks (owner_type='staff')
-- have neither - they are triggered by screening_requests in the aml schema,
-- not by verification_requests or business_sessions.
--
-- This migration:
--   1. Adds aml_screening_reference column for AML deliveries
--   2. Relaxes the subject check to allow all three to be NULL for system/AML
--      webhooks, but still prevents both person and business being set at once.
--   3. Keeps existing rows valid.
--
-- Everything is guarded on public.webhook_deliveries existing. The table is
-- created by 20260319_add_webhook_deliveries.sql, which sorts before this file
-- - but on a database where that one was skipped (MIGRATIONS_LENIENT, or a boot
-- that never found MIGRATIONS_DIR at all) an unguarded ALTER raises, the strict
-- runner exits, and every migration after this one is abandoned mid-run. A
-- delivery log that does not exist yet needs no relaxation: the app provisions it
-- in the relaxed shape (backend/src/services/webhookSchema.ts), so skipping is
-- the correct no-op.

DO $$
BEGIN
  IF to_regclass('public.webhook_deliveries') IS NULL THEN
    RAISE NOTICE 'Skipping AML delivery relaxation: public.webhook_deliveries does not exist';
    RETURN;
  END IF;

  -- Add column for AML screening reference (text, not FK - aml.screening_requests.id is SERIAL)
  ALTER TABLE public.webhook_deliveries
    ADD COLUMN IF NOT EXISTS aml_screening_reference TEXT;

  CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_aml_ref
    ON public.webhook_deliveries(aml_screening_reference)
    WHERE aml_screening_reference IS NOT NULL;

  -- Drop old strict check and replace with relaxed one
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.webhook_deliveries'::regclass
       AND conname = 'webhook_deliveries_subject_check'
  ) THEN
    ALTER TABLE public.webhook_deliveries DROP CONSTRAINT webhook_deliveries_subject_check;
  END IF;

  -- New constraint: at most one of verification_request_id / business_session_id is set,
  -- and if aml_screening_reference is set, the other two must be NULL.
  -- This allows (NULL, NULL, NULL) for system webhooks and (NULL, NULL, ref) for AML,
  -- while still preventing ambiguous rows like (verif_id, business_id, NULL).
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.webhook_deliveries'::regclass
       AND conname = 'webhook_deliveries_subject_check'
  ) THEN
    ALTER TABLE public.webhook_deliveries
      ADD CONSTRAINT webhook_deliveries_subject_check CHECK (
        -- Person-only
        (verification_request_id IS NOT NULL AND business_session_id IS NULL AND aml_screening_reference IS NULL)
        OR
        -- Business-only
        (verification_request_id IS NULL AND business_session_id IS NOT NULL AND aml_screening_reference IS NULL)
        OR
        -- AML-only
        (verification_request_id IS NULL AND business_session_id IS NULL AND aml_screening_reference IS NOT NULL)
        OR
        -- System / staff generic (no subject, payload carries context)
        (verification_request_id IS NULL AND business_session_id IS NULL AND aml_screening_reference IS NULL)
      ) NOT VALID;

    -- Validate if existing rows are clean (they should be: old rows are person or business)
    BEGIN
      ALTER TABLE public.webhook_deliveries VALIDATE CONSTRAINT webhook_deliveries_subject_check;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'webhook_deliveries_subject_check left NOT VALID: some historical rows violate relaxed check';
    END;
  END IF;
END $$;
