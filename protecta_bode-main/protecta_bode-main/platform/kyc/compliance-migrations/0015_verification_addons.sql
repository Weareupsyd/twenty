-- Repair existing tables as well as fresh installs. Migration 0013 only
-- declares addons inside CREATE TABLE IF NOT EXISTS, which leaves an older
-- verification_requests table unchanged. Do not edit/replay that migration:
-- databases that have already recorded it need this new, additive migration.
-- Mirrors core migration 70 for deployments using only the compliance runner.

ALTER TABLE public.verification_requests
  ADD COLUMN IF NOT EXISTS addons JSONB;
