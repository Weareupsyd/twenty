-- Persist per-session add-ons (including an explicit aml_screening: false).
-- The core migrations create verification_requests before compliance migration
-- 0013. Its CREATE TABLE IF NOT EXISTS cannot add columns to that existing table,
-- so even a fresh community install was missing addons and /initialize failed
-- with 42703. Use a new migration so already-migrated databases are repaired too.
-- Nullable, with no backfill: existing rows and their verification state survive.

ALTER TABLE public.verification_requests
  ADD COLUMN IF NOT EXISTS addons JSONB;
