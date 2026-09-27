-- 0014 - self-healing public.mobile_handoff_sessions.
--
-- The desktop -> phone QR handoff (POST /api/verify/handoff/create, used by
-- /live-verification and the ContinueOnPhone widget) inserts into
-- public.mobile_handoff_sessions. That table is only created by the Kabila
-- supabase boot runner (12 + 23 + 32 + 50). With MIGRATIONS_LENIENT=true a
-- failed/skipped boot migration leaves the table missing (or in its legacy
-- shape with a raw api_key column), and every QR generation 500s with
-- "Failed to create handoff session" -> the UI shows
-- "Could not generate QR code. Please try again."
--
-- This migration mirrors the final supabase schema (12_add_mobile_handoff_sessions
-- + 23_handoff_source + 32_handoff_verification_id + 50_handoff_remove_raw_api_key)
-- as guarded, idempotent DDL. Safe to re-run every boot - same pattern as
-- 0012/0013.

CREATE TABLE IF NOT EXISTS public.mobile_handoff_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token           CHAR(64) NOT NULL UNIQUE,       -- sha256 hash of the raw token (hex)
    api_key_id      UUID NOT NULL,
    user_id         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
    source          TEXT NOT NULL DEFAULT 'api',
    verification_id TEXT,
    result          JSONB,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Repair legacy shapes (partial boot-runner state):
--   • 12-era table: raw api_key TEXT column, no api_key_id
--   • pre-23: missing source
--   • pre-32: missing verification_id
DO $$
BEGIN
    -- source (23_handoff_source)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'mobile_handoff_sessions' AND column_name = 'source'
    ) THEN
        ALTER TABLE public.mobile_handoff_sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'api';
    END IF;

    -- verification_id (32_handoff_verification_id)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'mobile_handoff_sessions' AND column_name = 'verification_id'
    ) THEN
        ALTER TABLE public.mobile_handoff_sessions ADD COLUMN verification_id TEXT;
    END IF;

    -- api_key -> api_key_id (50_handoff_remove_raw_api_key). Sessions are
    -- 30-minute TTL rows, so clearing stragglers before the NOT NULL add is safe.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'mobile_handoff_sessions' AND column_name = 'api_key_id'
    ) THEN
        DELETE FROM public.mobile_handoff_sessions;
        ALTER TABLE public.mobile_handoff_sessions ADD COLUMN api_key_id UUID NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'mobile_handoff_sessions' AND column_name = 'api_key'
    ) THEN
        ALTER TABLE public.mobile_handoff_sessions DROP COLUMN api_key;
    END IF;

    -- FK to api_keys - added conditionally so a fresh volume where 0012 has
    -- not yet created public.api_keys doesn't fail the whole migration pass.
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'api_keys'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'mobile_handoff_sessions_api_key_id_fkey'
    ) THEN
        ALTER TABLE public.mobile_handoff_sessions
            ADD CONSTRAINT mobile_handoff_sessions_api_key_id_fkey
            FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS mobile_handoff_sessions_token_idx      ON public.mobile_handoff_sessions (token);
CREATE INDEX IF NOT EXISTS mobile_handoff_sessions_expires_at_idx ON public.mobile_handoff_sessions (expires_at);
CREATE INDEX IF NOT EXISTS mobile_handoff_sessions_api_key_id_idx ON public.mobile_handoff_sessions (api_key_id);
