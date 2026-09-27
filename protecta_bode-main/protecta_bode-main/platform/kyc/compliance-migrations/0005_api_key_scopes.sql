-- Machine keys gain a scope so a single api_keys table can later cover
-- kyc / aml / compliance. Existing rows default to kyc (current behaviour).
-- AML's env-level API_KEY_READ / API_KEY_ADMIN keep working in Phase 1.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'api_keys'
    ) THEN
        ALTER TABLE public.api_keys
            ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT ARRAY['kyc']::text[];
    END IF;
END $$;
