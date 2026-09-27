-- Repair existing verification_requests tables as well as fresh installs.
-- Migration 0013 declares ocr_data inside CREATE TABLE IF NOT EXISTS, which
-- does not alter a table previously created by the core migration runner.
-- Keep this additive repair separate so compliance-only deployments also gain
-- the field required by the front-document endpoint. Mirrors core migration 71.

ALTER TABLE public.verification_requests
  ADD COLUMN IF NOT EXISTS ocr_data JSONB;
