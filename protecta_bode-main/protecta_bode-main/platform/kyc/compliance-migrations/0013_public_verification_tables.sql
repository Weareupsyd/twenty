-- Phase 5.2 - self-healing public verification tables.
--
-- 0012_public_core_tables.sql bootstraps public.developers / public.api_keys so the
-- combined console and hosted-pages can read them. But the hosted-page launcher
-- (and the demo/developer verification flow) also writes to the KYC subject +
-- verification tables that only the Kabila supabase migration runner creates:
--
--     relation "public.users" does not exist
--     relation "public.verification_requests" does not exist
--     relation "public.verification_contexts" does not exist
--     relation "public.documents" does not exist
--     relation "public.selfies" does not exist
--
-- When that boot-time runner has not populated them (partial deploy, lenient
-- skip, separate volume) every hosted-page/demo session launch 500s and the
-- staff dashboard shows no verification results. These CREATE TABLE IF NOT
-- EXISTS statements match the current supabase schema (01 + 02 + 03 + 05 + 14
-- + 15 + 16 + 18 + 20 + 22 + 24 + 29 + 36 + 38 + 41 + 43 + 54 + 56 +
-- 20260629 + 20260701) so they are a no-op where the tables already exist and
-- a self-healing bootstrap where they do not. Safe to re-run every boot.
--
-- Dependency order: users -> verification_requests -> documents -> selfies ->
-- verification_contexts. document_id/selfie_id are kept as plain UUID columns
-- here (the supabase runner adds the FK variants when it is present) to avoid
-- cross-table ordering failures on a fresh volume.

CREATE TABLE IF NOT EXISTS public.users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       VARCHAR(255),
    first_name  VARCHAR(100),
    last_name   VARCHAR(100),
    phone       VARCHAR(20),
    external_id VARCHAR(255),
    status      VARCHAR(20) DEFAULT 'active',
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (email);

CREATE TABLE IF NOT EXISTS public.verification_requests (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    developer_id                UUID NOT NULL REFERENCES public.developers(id) ON DELETE CASCADE,
    status                      VARCHAR(20) NOT NULL DEFAULT 'pending',
    verification_type           VARCHAR(20) DEFAULT 'document',
    verification_mode           VARCHAR(20) DEFAULT 'full',
    age_threshold               SMALLINT,
    confidence_score            DECIMAL(3,2),
    ocr_data                    JSONB,
    document_id                 UUID,
    selfie_id                   UUID,
    face_match_score            DECIMAL(6,4),
    liveness_score              DECIMAL(6,4),
    cross_validation_score      DECIMAL(6,4),
    photo_consistency_score     DECIMAL(6,4),
    live_capture_completed      BOOLEAN DEFAULT FALSE,
    back_of_id_uploaded         BOOLEAN DEFAULT FALSE,
    enhanced_verification_completed BOOLEAN DEFAULT FALSE,
    address_verification_status VARCHAR(20),
    address_data                JSONB,
    address_match_score         DECIMAL(6,4),
    voice_challenge             TEXT,
    voice_challenge_created_at  TIMESTAMPTZ,
    voice_match_score           REAL,
    is_sandbox                  BOOLEAN DEFAULT FALSE,
    source                      TEXT NOT NULL DEFAULT 'api',
    addons                      JSONB,
    failure_reason              TEXT,
    manual_review_reason        TEXT,
    external_verification_id    VARCHAR(255),
    issuing_country             VARCHAR(2),
    client_ip                   VARCHAR(64),
    step_timestamps             JSONB,
    session_started_at          TIMESTAMPTZ,
    processing_completed_at     TIMESTAMPTZ,
    completed_at                TIMESTAMPTZ,
    retry_count                 INTEGER NOT NULL DEFAULT 0,
    duplicate_flags             JSONB,
    parent_verification_id      UUID,
    session_token_hash          CHAR(64),
    session_token_expires_at    TIMESTAMPTZ,
    session_api_key_id          UUID,
    api_key_id                  UUID,
    reviewed_by                 TEXT,
    reviewed_at                 TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vr_session_token
    ON public.verification_requests (session_token_hash)
    WHERE session_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_verification_requests_user_id
    ON public.verification_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_verification_requests_status
    ON public.verification_requests (status);
CREATE INDEX IF NOT EXISTS idx_verification_requests_created
    ON public.verification_requests (created_at);
CREATE INDEX IF NOT EXISTS idx_verification_requests_developer
    ON public.verification_requests (developer_id);

CREATE TABLE IF NOT EXISTS public.documents (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    verification_request_id UUID NOT NULL REFERENCES public.verification_requests(id) ON DELETE CASCADE,
    document_type           VARCHAR(50) NOT NULL,
    file_path               TEXT,
    file_name               VARCHAR(255) NOT NULL,
    file_size               INTEGER,
    mime_type               VARCHAR(100),
    ocr_data                JSONB,
    quality_score           DECIMAL(6,4),
    is_back_of_id           BOOLEAN DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_documents_verification_request_id
    ON public.documents (verification_request_id);

CREATE TABLE IF NOT EXISTS public.selfies (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    verification_request_id UUID NOT NULL REFERENCES public.verification_requests(id) ON DELETE CASCADE,
    file_path               TEXT,
    file_name               VARCHAR(255) NOT NULL,
    file_size               INTEGER,
    liveness_score          DECIMAL(6,4),
    face_detected           BOOLEAN DEFAULT FALSE,
    enrollment_audio_path   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_selfies_verification_request_id
    ON public.selfies (verification_request_id);

CREATE TABLE IF NOT EXISTS public.verification_contexts (
    verification_id UUID PRIMARY KEY,
    context         JSONB NOT NULL DEFAULT '{}',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS verification_contexts_updated_at_idx
    ON public.verification_contexts (updated_at);
