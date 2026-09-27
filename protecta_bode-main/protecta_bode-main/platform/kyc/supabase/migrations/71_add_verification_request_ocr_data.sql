-- Persist the identity fields extracted from the front document on the
-- verification request. Core migration 01 originally created ocr_data only
-- on documents. The front-document endpoint also writes it to
-- verification_requests, and compliance migration 0013 cannot add that
-- column when the core table already exists because it uses CREATE TABLE IF
-- NOT EXISTS. Additive repair for both fresh and already-migrated databases.
--
-- Nullable with no backfill: completed sessions and their existing data are
-- left untouched, while new front-document uploads can persist OCR results.

ALTER TABLE public.verification_requests
  ADD COLUMN IF NOT EXISTS ocr_data JSONB;
