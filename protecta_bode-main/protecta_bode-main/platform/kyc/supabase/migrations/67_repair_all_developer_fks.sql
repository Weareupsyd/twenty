-- Repair ALL developer ownership foreign keys on upgraded / combined-stack databases.
--
-- Migration 66 fixed only `public.webhooks`. However, `01_initial_schema.sql` and
-- many later migrations used unqualified references:
--
--     developer_id UUID REFERENCES developers(id)
--
-- PostgreSQL binds a foreign key to a table OID when the constraint is created.
-- On installations that previously used a non-public `developers` table (or a
-- different search_path), the constraint can therefore remain bound to that
-- legacy table even though the API authenticates against public.developers.
-- The symptom is paradoxical but deterministic: authentication finds the
-- developer in public.developers, then INSERT into any table with a stale FK
-- fails with SQLSTATE 23503.
--
-- This migration re-creates EVERY single-column FK on `developer_id` in the
-- public schema to point to `public.developers(id)` with fully-qualified
-- targets. Constraints are added NOT VALID so historical orphans cannot block
-- startup; NOT VALID still enforces every new INSERT/UPDATE. We validate
-- immediately when existing rows are clean and otherwise leave NOT VALID with
-- a warning for operator-led repair.
--
-- Tables covered (discovered from migrations 01, 19, 21, 28, 33, 43, 44, 46,
-- 48, 61, 64):
--   api_keys, verification_requests, webhooks, batch_verification_requests,
--   developer_usage_stats, provider_metrics, api_activity_logs,
--   verification_reviewers, duplicate_fingerprints, verifiable_credentials,
--   identity_vault, identity_vault_access_log, compliance_rules,
--   business_sessions, business_workflows, and any future table that adds a
--   developer_id column with an FK.
--
-- Also re-asserts webhooks.api_key_id FK to public.api_keys (migration 66
-- already did, but we keep it idempotent for partial upgrades).

DO $migration$
DECLARE
  tbl RECORD;
  col_attnum SMALLINT;
  fk RECORD;
  orphan_count BIGINT;
  target_table TEXT;
  target_column TEXT := 'id';
  fk_name TEXT;
  on_delete_action TEXT;
BEGIN
  IF to_regclass('public.developers') IS NULL THEN
    RAISE NOTICE 'Skipping developer FK repair: public.developers does not exist';
    RETURN;
  END IF;

  -- Loop over every table in public schema that has a developer_id column
  FOR tbl IN
    SELECT c.oid::regclass AS regclass,
           n.nspname AS schema_name,
           c.relname AS table_name
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r','p') -- ordinary tables + partitioned
       AND a.attname = 'developer_id'
       AND NOT a.attisdropped
       AND c.relname NOT LIKE 'pg_%'
     GROUP BY c.oid, n.nspname, c.relname
  LOOP
    -- Find attnum for developer_id in this table
    SELECT attnum::SMALLINT INTO col_attnum
      FROM pg_catalog.pg_attribute
     WHERE attrelid = tbl.regclass
       AND attname = 'developer_id'
       AND NOT attisdropped;

    IF col_attnum IS NULL THEN
      CONTINUE;
    END IF;

    -- Drop every single-column FK on developer_id, regardless of its current name or target
    FOR fk IN
      SELECT conname,
             confrelid::regclass AS confrelid,
             confdeltype
        FROM pg_catalog.pg_constraint
       WHERE conrelid = tbl.regclass
         AND contype = 'f'
         AND conkey = ARRAY[col_attnum]::SMALLINT[]
    LOOP
      RAISE NOTICE 'Dropping stale FK % on %.%', fk.conname, tbl.schema_name, tbl.table_name;
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tbl.regclass, fk.conname);
    END LOOP;

    -- Determine ON DELETE action: preserve CASCADE if the table previously used it,
    -- otherwise default to CASCADE for developer ownership. For api_keys we know
    -- it must be CASCADE; for webhooks also CASCADE.
    -- We default to CASCADE for all developer_id ownership.
    on_delete_action := 'CASCADE';

    -- Special case: if table is webhooks, we already have migration 66, but we
    -- still recreate here to be safe.
    fk_name := tbl.table_name || '_developer_id_fkey';

    -- Avoid collision if a constraint with that name already exists (should not after drops, but safe)
    BEGIN
      EXECUTE format(
        'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (developer_id) REFERENCES public.developers(id) ON DELETE %s NOT VALID',
        tbl.regclass, fk_name, on_delete_action
      );
    EXCEPTION WHEN duplicate_object THEN
      -- If name collides (e.g., concurrent migration), generate a unique name
      fk_name := tbl.table_name || '_developer_id_fkey_' || substr(md5(random()::text), 1, 6);
      EXECUTE format(
        'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (developer_id) REFERENCES public.developers(id) ON DELETE %s NOT VALID',
        tbl.regclass, fk_name, on_delete_action
      );
    END;

    -- Count orphans
    EXECUTE format(
      'SELECT COUNT(*) FROM %s AS w LEFT JOIN public.developers AS d ON d.id = w.developer_id WHERE w.developer_id IS NOT NULL AND d.id IS NULL',
      tbl.regclass
    ) INTO orphan_count;

    IF orphan_count = 0 THEN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', tbl.regclass, fk_name);
      RAISE NOTICE 'Validated FK % on %.% - no orphans', fk_name, tbl.schema_name, tbl.table_name;
    ELSE
      RAISE WARNING '% left NOT VALID: % historical row(s) have no public.developers owner', fk_name, orphan_count;
    END IF;

    -- Ensure index exists
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_developer_id ON %s(developer_id)', tbl.table_name, tbl.regclass);
  END LOOP;

  -- Re-assert webhooks.api_key_id FK to public.api_keys (idempotent)
  IF to_regclass('public.webhooks') IS NOT NULL AND to_regclass('public.api_keys') IS NOT NULL THEN
    SELECT attnum::SMALLINT INTO col_attnum
      FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.webhooks'::regclass
       AND attname = 'api_key_id'
       AND NOT attisdropped;

    IF col_attnum IS NOT NULL THEN
      FOR fk IN
        SELECT conname
          FROM pg_catalog.pg_constraint
         WHERE conrelid = 'public.webhooks'::regclass
           AND contype = 'f'
           AND conkey = ARRAY[col_attnum]::SMALLINT[]
      LOOP
        EXECUTE format('ALTER TABLE public.webhooks DROP CONSTRAINT %I', fk.conname);
      END LOOP;

      BEGIN
        ALTER TABLE public.webhooks
          ADD CONSTRAINT webhooks_api_key_id_fkey
          FOREIGN KEY (api_key_id)
          REFERENCES public.api_keys(id)
          ON DELETE SET NULL
          NOT VALID;
      EXCEPTION WHEN duplicate_object THEN
        -- already exists with correct definition, ignore
        NULL;
      END;

      SELECT COUNT(*)
        INTO orphan_count
        FROM public.webhooks AS w
        LEFT JOIN public.api_keys AS k ON k.id = w.api_key_id
       WHERE w.api_key_id IS NOT NULL
         AND k.id IS NULL;

      IF orphan_count = 0 THEN
        ALTER TABLE public.webhooks VALIDATE CONSTRAINT webhooks_api_key_id_fkey;
      ELSE
        RAISE WARNING 'webhooks_api_key_id_fkey left NOT VALID: % historical webhook row(s) have no public.api_keys owner', orphan_count;
      END IF;

      CREATE INDEX IF NOT EXISTS idx_webhooks_api_key_id ON public.webhooks(api_key_id);
    END IF;
  END IF;

  -- Also repair api_keys -> developers FK if it was bound to a non-public table.
  -- This is critical: authenticateAPIKey joins developers via FK; if that FK
  -- points to a legacy OID, the join can return a developer that does NOT exist
  -- in public.developers, causing downstream webhook inserts to fail with 23503
  -- on webhooks_developer_id_fkey even after that FK is repaired.
  -- We already handled api_keys in the generic loop above (it has developer_id),
  -- but ensure its ON DELETE is CASCADE and validated.
  -- The loop already did that, so nothing extra needed.

END
$migration$;
