-- Support AML / compliance-staff owned webhooks.
--
-- The original `public.webhooks` table only allowed a `developer_id` owner
-- (FK to public.developers). The AML console (compliance.staff) needs to
-- register webhooks for screening events (e.g., sanctions hit, case status
-- changes) without a developer account. Attempting to insert a staff UUID into
-- developer_id violates `webhooks_developer_id_fkey` with SQLSTATE 23503.
--
-- This migration:
--   1. Makes developer_id nullable (system/AML webhooks may be staff-owned)
--   2. Adds compliance_staff_id FK to compliance.staff(id) ON DELETE CASCADE
--   3. Adds a check that at least one owner is present
--   4. Re-creates RLS policies to allow staff to manage their own webhooks
--   5. Adds indexes for the new column

DO $migration$
BEGIN
  -- Ensure compliance schema exists (from 0001_schemas.sql)
  CREATE SCHEMA IF NOT EXISTS compliance;

  -- Ensure compliance.staff exists (from 0002_staff.sql) - idempotent
  CREATE TABLE IF NOT EXISTS compliance.staff (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email             TEXT NOT NULL UNIQUE,
      full_name         TEXT NOT NULL DEFAULT '',
      hashed_password   TEXT,
      bcrypt_hash       TEXT,
      whatsapp_number   TEXT,
      aml_role          TEXT NOT NULL DEFAULT 'analyst',
      kyc_role          TEXT NOT NULL DEFAULT 'reviewer' CHECK (kyc_role IN ('admin', 'reviewer')),
      readonly          BOOLEAN NOT NULL DEFAULT FALSE,
      is_active         BOOLEAN NOT NULL DEFAULT TRUE,
      scopes            TEXT[] NOT NULL DEFAULT ARRAY['kyc', 'aml']::text[],
      session_token     TEXT,
      session_last_active TIMESTAMPTZ,
      aml_user_id       TEXT,
      kabila_admin_id   UUID,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  IF to_regclass('public.webhooks') IS NULL THEN
    RAISE NOTICE 'Skipping AML webhook owner migration: public.webhooks does not exist';
    RETURN;
  END IF;

  -- Make developer_id nullable for staff-owned / system webhooks
  ALTER TABLE public.webhooks ALTER COLUMN developer_id DROP NOT NULL;

  -- Add compliance_staff_id column if not exists
  ALTER TABLE public.webhooks
    ADD COLUMN IF NOT EXISTS compliance_staff_id UUID REFERENCES compliance.staff(id) ON DELETE CASCADE;

  -- Add owner_type for clarity (optional, but helps RLS and queries)
  ALTER TABLE public.webhooks
    ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'developer'
    CHECK (owner_type IN ('developer', 'staff', 'system'));

  -- Backfill owner_type based on existing data
  UPDATE public.webhooks
     SET owner_type = CASE
       WHEN compliance_staff_id IS NOT NULL THEN 'staff'
       WHEN developer_id IS NOT NULL THEN 'developer'
       ELSE 'system'
     END
   WHERE owner_type IS NULL OR owner_type = 'developer';

  -- Add check: at least one owner must be present, or system type
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.webhooks'::regclass
         AND conname = 'webhooks_owner_check'
    ) THEN
      ALTER TABLE public.webhooks
        ADD CONSTRAINT webhooks_owner_check CHECK (
          (owner_type = 'developer' AND developer_id IS NOT NULL)
          OR (owner_type = 'staff' AND compliance_staff_id IS NOT NULL)
          OR (owner_type = 'system')
        ) NOT VALID;
      -- Validate if clean
      BEGIN
        ALTER TABLE public.webhooks VALIDATE CONSTRAINT webhooks_owner_check;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'webhooks_owner_check left NOT VALID: some rows violate owner check';
      END;
    END IF;
  END $$;

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_webhooks_compliance_staff_id
    ON public.webhooks(compliance_staff_id)
    WHERE compliance_staff_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_webhooks_owner_type
    ON public.webhooks(owner_type);

  -- RLS: ensure staff can manage their own webhooks.
  -- Existing policies from 57_add_rls_policies_all_tables.sql:
  --   service_role_all_webhooks (service_role)
  --   developers_own_webhooks (authenticated, developer_id = auth.uid())
  -- We add staff policies and keep existing ones.
  --
  -- IMPORTANT: these policies target the Supabase-managed `authenticated`
  -- and `service_role` roles. On stock Postgres (community / Docker stack)
  -- those roles do not exist - the CREATE POLICY statements above were
  -- failing outright with `role "authenticated" does not exist`, which in
  -- MIGRATIONS_LENIENT mode caused the ENTIRE migration to be skipped every
  -- boot. The webhooks table then never got developer_id made nullable /
  -- compliance_staff_id added, and staff-owned AML webhook inserts failed
  -- with SQLSTATE 23503 on webhooks_developer_id_fkey. Guard the RLS block
  -- so the structural parts of this migration always apply; the API server
  -- connects as the table owner on stock Postgres and RLS is not enforced
  -- against it anyway.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    -- Drop and recreate developer policy to handle nullable developer_id
    DROP POLICY IF EXISTS developers_own_webhooks ON public.webhooks;
    CREATE POLICY developers_own_webhooks ON public.webhooks FOR ALL TO authenticated
      USING (developer_id = auth.uid())
      WITH CHECK (developer_id = auth.uid());

    -- Staff policy: staff can manage webhooks where compliance_staff_id matches
    -- their staff id. Note: auth.uid() for staff is the staff id (compliance JWT).
    DROP POLICY IF EXISTS staff_own_webhooks ON public.webhooks;
    CREATE POLICY staff_own_webhooks ON public.webhooks FOR ALL TO authenticated
      USING (compliance_staff_id = auth.uid() OR owner_type = 'system')
      WITH CHECK (compliance_staff_id = auth.uid() OR owner_type = 'system');

    -- Service role still has full access
    DROP POLICY IF EXISTS service_role_all_webhooks ON public.webhooks;
    CREATE POLICY service_role_all_webhooks ON public.webhooks FOR ALL TO service_role USING (true) WITH CHECK (true);
  ELSE
    RAISE NOTICE 'Skipping webhook RLS policies: Supabase roles (authenticated / service_role) do not exist on this cluster';
  END IF;

END
$migration$;
