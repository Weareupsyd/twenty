-- Phase 5.1 - public schema core tables for the combined console + developer
-- portal + hosted pages.
--
-- The Kabila supabase migrations (backend-node/supabase/migrations) normally
-- create public.developers / public.api_keys at API boot. But the combined
-- console and hosted-pages endpoints query them directly, and when that
-- boot-time runner has not populated them (partial deploy, lenient skip,
-- separate volume) every hosted-pages/developer call 500s with
--   relation "public.developers" does not exist
--   relation "public.api_keys" does not exist
--
-- These CREATE TABLE IF NOT EXISTS statements match the current supabase
-- schema (01 + 04 + 05 + 30 + 40 + 42 + 58 + operator-email) so they are a
-- no-op where the tables already exist, and a self-healing bootstrap where
-- they do not. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.developers (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                   VARCHAR(255) UNIQUE NOT NULL,
    name                    VARCHAR(255) NOT NULL,
    company                 VARCHAR(255),
    webhook_url             TEXT,
    is_verified             BOOLEAN DEFAULT FALSE,
    status                  TEXT NOT NULL DEFAULT 'active',
    branding_logo_url       TEXT,
    branding_accent_color   TEXT,
    branding_company_name   TEXT,
    page_builder_config     JSONB DEFAULT NULL,
    verification_slug       TEXT DEFAULT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_developers_email
    ON public.developers (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_developers_verification_slug
    ON public.developers (verification_slug)
    WHERE verification_slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.api_keys (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    developer_id          UUID NOT NULL REFERENCES public.developers(id) ON DELETE CASCADE,
    key_hash              TEXT NOT NULL,
    key_prefix            VARCHAR(20) NOT NULL,
    name                  VARCHAR(255) NOT NULL,
    is_sandbox            BOOLEAN NOT NULL DEFAULT FALSE,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    is_service            BOOLEAN NOT NULL DEFAULT FALSE,
    service_product       TEXT,
    service_environment   TEXT,
    service_label         TEXT,
    operator_email        TEXT,
    revoked_at            TIMESTAMPTZ,
    revoked_reason        TEXT,
    scopes                TEXT[] NOT NULL DEFAULT ARRAY['kyc']::text[],
    last_used_at          TIMESTAMPTZ,
    expires_at            TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_developer_id
    ON public.api_keys (developer_id);
CREATE INDEX IF NOT EXISTS api_keys_service_lookup_idx
    ON public.api_keys (key_hash)
    WHERE is_service = TRUE AND is_active = TRUE;
CREATE INDEX IF NOT EXISTS api_keys_operator_email_idx
    ON public.api_keys (operator_email)
    WHERE operator_email IS NOT NULL;
