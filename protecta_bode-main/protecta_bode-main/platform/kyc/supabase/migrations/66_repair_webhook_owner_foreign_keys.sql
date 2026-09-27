-- Repair webhook ownership foreign keys on upgraded / combined-stack databases.
--
-- `01_initial_schema.sql` originally used unqualified references:
--
--     webhooks.developer_id REFERENCES developers(id)
--
-- PostgreSQL binds a foreign key to a table OID when the constraint is created.
-- On installations that previously used a non-public `developers` table (or a
-- different search_path), the constraint can therefore remain bound to that
-- legacy table even though the API authenticates against public.developers.
-- The symptom is paradoxical but deterministic: authentication finds the
-- developer, then INSERT INTO public.webhooks fails with SQLSTATE 23503 on
-- `webhooks_developer_id_fkey`.
--
-- Re-create both webhook-owner FKs with fully-qualified public targets.  The
-- constraints are added NOT VALID so a historical orphan cannot block startup;
-- NOT VALID still enforces every new INSERT/UPDATE.  We validate immediately
-- when the existing rows are clean and otherwise retain the rows for an
-- operator-led data repair rather than deleting customer webhook configuration.

DO $migration$
DECLARE
  developer_attnum SMALLINT;
  api_key_attnum SMALLINT;
  fk RECORD;
  orphan_count BIGINT;
BEGIN
  IF to_regclass('public.webhooks') IS NULL
     OR to_regclass('public.developers') IS NULL THEN
    RAISE NOTICE 'Skipping webhook FK repair: public.webhooks or public.developers does not exist';
    RETURN;
  END IF;

  SELECT attnum::SMALLINT
    INTO developer_attnum
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.webhooks'::regclass
     AND attname = 'developer_id'
     AND NOT attisdropped;

  IF developer_attnum IS NULL THEN
    RAISE NOTICE 'Skipping webhook developer FK repair: public.webhooks.developer_id does not exist';
  ELSE
    -- Drop every single-column FK on developer_id, including a legacy FK with
    -- a non-standard name. Leaving even one stale constraint in place would
    -- continue to reject otherwise-valid inserts.
    FOR fk IN
      SELECT conname
        FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.webhooks'::regclass
         AND contype = 'f'
         AND conkey = ARRAY[developer_attnum]::SMALLINT[]
    LOOP
      EXECUTE format(
        'ALTER TABLE public.webhooks DROP CONSTRAINT %I',
        fk.conname
      );
    END LOOP;

    ALTER TABLE public.webhooks
      ADD CONSTRAINT webhooks_developer_id_fkey
      FOREIGN KEY (developer_id)
      REFERENCES public.developers(id)
      ON DELETE CASCADE
      NOT VALID;

    SELECT COUNT(*)
      INTO orphan_count
      FROM public.webhooks AS w
      LEFT JOIN public.developers AS d ON d.id = w.developer_id
     WHERE w.developer_id IS NOT NULL
       AND d.id IS NULL;

    IF orphan_count = 0 THEN
      ALTER TABLE public.webhooks
        VALIDATE CONSTRAINT webhooks_developer_id_fkey;
    ELSE
      RAISE WARNING
        'webhooks_developer_id_fkey left NOT VALID: % historical webhook row(s) have no public.developers owner',
        orphan_count;
    END IF;

    CREATE INDEX IF NOT EXISTS idx_webhooks_developer_id
      ON public.webhooks(developer_id);
  END IF;

  -- api_key_id was added by migration 20260319. Repair it when present, but
  -- keep this migration compatible with partially-upgraded installations.
  IF to_regclass('public.api_keys') IS NOT NULL THEN
    SELECT attnum::SMALLINT
      INTO api_key_attnum
      FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.webhooks'::regclass
       AND attname = 'api_key_id'
       AND NOT attisdropped;

    IF api_key_attnum IS NOT NULL THEN
      FOR fk IN
        SELECT conname
          FROM pg_catalog.pg_constraint
         WHERE conrelid = 'public.webhooks'::regclass
           AND contype = 'f'
           AND conkey = ARRAY[api_key_attnum]::SMALLINT[]
      LOOP
        EXECUTE format(
          'ALTER TABLE public.webhooks DROP CONSTRAINT %I',
          fk.conname
        );
      END LOOP;

      ALTER TABLE public.webhooks
        ADD CONSTRAINT webhooks_api_key_id_fkey
        FOREIGN KEY (api_key_id)
        REFERENCES public.api_keys(id)
        ON DELETE SET NULL
        NOT VALID;

      SELECT COUNT(*)
        INTO orphan_count
        FROM public.webhooks AS w
        LEFT JOIN public.api_keys AS k ON k.id = w.api_key_id
       WHERE w.api_key_id IS NOT NULL
         AND k.id IS NULL;

      IF orphan_count = 0 THEN
        ALTER TABLE public.webhooks
          VALIDATE CONSTRAINT webhooks_api_key_id_fkey;
      ELSE
        RAISE WARNING
          'webhooks_api_key_id_fkey left NOT VALID: % historical webhook row(s) have no public.api_keys owner',
          orphan_count;
      END IF;

      CREATE INDEX IF NOT EXISTS idx_webhooks_api_key_id
        ON public.webhooks(api_key_id);
    END IF;
  END IF;
END
$migration$;
