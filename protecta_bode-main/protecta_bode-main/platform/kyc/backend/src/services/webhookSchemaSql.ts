/**
 * Webhook ownership + delivery-log DDL - the exact SQL the API applies when it
 * self-heals, kept in its own module so it can be printed or piped without
 * loading the database adapter.
 *
 * This file has no imports on purpose: `repair-webhook-owners.ts --print-sql`
 * and `../../../scripts/repair-webhooks.sh` (host-side, no rebuild) both read
 * these two constants verbatim, so there is exactly one copy of the repair.
 * See ./webhookSchema.ts for why each block exists.
 */

/**
 * The canonical repair. Single `DO` block so it executes atomically, with each
 * section in its own exception-handling sub-block so one denied statement
 * (e.g. `CREATE POLICY` without owner privileges) cannot undo the structural
 * repair the request depends on.
 *
 * `src/scripts/repair-webhook-owners.ts --print-sql` prints this string and
 * `compliance-stack/scripts/repair-webhooks.sh` extracts it from this file, so
 * the running instance and the app can never drift apart.
 */
export const WEBHOOK_OWNER_SCHEMA_SQL = `DO $kabila_webhook_owner_schema$
DECLARE
  v_attnum     smallint;
  v_fk         record;
  v_orphans    bigint;
  v_added      boolean := false;
  v_has_owner  boolean := false;
BEGIN
  -- ── 1. webhooks table ───────────────────────────────────────────────
  -- Absent entirely (a database created before webhooks existed, or a
  -- half-applied install): create the current shape and stop. Everything
  -- below is a repair of an existing table.
  IF to_regclass('public.webhooks') IS NULL THEN
    IF to_regclass('public.developers') IS NULL THEN
      RAISE NOTICE 'webhook self-heal: no public.webhooks and no public.developers - nothing to attach ownership to';
      RETURN;
    END IF;

    CREATE TABLE IF NOT EXISTS public.webhooks (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      developer_id        UUID,
      url                 TEXT NOT NULL,
      events              TEXT[],
      secret_key          VARCHAR(255),
      secret_token        VARCHAR(255),
      is_active           BOOLEAN DEFAULT TRUE,
      is_sandbox          BOOLEAN DEFAULT FALSE,
      api_key_id          UUID,
      compliance_staff_id UUID,
      owner_type          TEXT NOT NULL DEFAULT 'developer'
                          CHECK (owner_type IN ('developer','staff','system')),
      created_at          TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_webhooks_developer_id ON public.webhooks(developer_id);
    RAISE NOTICE 'webhook self-heal: created public.webhooks';
  END IF;

  -- ── 2. columns the API reads and writes ─────────────────────────────
  -- Every add is nullable / defaulted: a NOT NULL add would abort on a table
  -- that already has rows. No single-column FK inline here on purpose - the
  -- targets are (re)bound in the repair blocks below, where a stale or absent
  -- target can be detected instead of failing the whole block.
  BEGIN
    ALTER TABLE public.webhooks
      ADD COLUMN IF NOT EXISTS events              TEXT[],
      ADD COLUMN IF NOT EXISTS secret_key          VARCHAR(255),
      ADD COLUMN IF NOT EXISTS secret_token        VARCHAR(255),
      ADD COLUMN IF NOT EXISTS is_active           BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS is_sandbox          BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS created_at          TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS api_key_id          UUID,
      ADD COLUMN IF NOT EXISTS compliance_staff_id UUID;

    -- owner_type is added separately (NOT NULL + CHECK) so the backfill below
    -- knows the difference between "brand new column, every row is still the
    -- default" and "already populated - do not touch anyone's owner".
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.webhooks'::regclass
         AND attname = 'owner_type'
         AND NOT attisdropped
    ) INTO v_has_owner;

    v_added := NOT v_has_owner;

    IF v_added THEN
      ALTER TABLE public.webhooks
        ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'developer'
          CHECK (owner_type IN ('developer','staff','system'));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'webhook self-heal: column adds skipped (%: %). A role-restricted database needs the migration files instead.', SQLSTATE, SQLERRM;
  END;

  -- Backfill the discriminator only when the column is brand new, so a normal
  -- boot never full-scans the table. Rows with no owner at all become
  -- 'system' - that is what makes the owner CHECK below satisfiable on a
  -- database whose developer_id column used to be NOT NULL and now is not.
  IF v_added THEN
    BEGIN
      UPDATE public.webhooks AS w
         SET owner_type = CASE
               WHEN w.compliance_staff_id IS NOT NULL AND w.developer_id IS NULL THEN 'staff'
               WHEN w.developer_id IS NOT NULL THEN 'developer'
               ELSE 'system'
             END
       WHERE w.owner_type = 'developer';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'webhook self-heal: owner_type backfill skipped (%: %)', SQLSTATE, SQLERRM;
    END;
  END IF;

  -- ── 3. developer_id: nullable, and bound to public.developers ───────
  SELECT attnum::smallint INTO v_attnum
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.webhooks'::regclass
     AND attname = 'developer_id'
     AND NOT attisdropped;

  IF v_attnum IS NULL THEN
    RAISE WARNING 'webhook self-heal: public.webhooks has no developer_id column - ownership cannot be repaired';
  ELSE
    BEGIN
      ALTER TABLE public.webhooks ALTER COLUMN developer_id DROP NOT NULL;

      FOR v_fk IN
        SELECT conname
          FROM pg_catalog.pg_constraint
         WHERE conrelid = 'public.webhooks'::regclass
           AND contype = 'f'
           AND conkey = ARRAY[v_attnum]::smallint[]
      LOOP
        RAISE NOTICE 'webhook self-heal: dropping stale FK % on public.webhooks', v_fk.conname;
        EXECUTE format('ALTER TABLE public.webhooks DROP CONSTRAINT %I', v_fk.conname);
      END LOOP;

      IF to_regclass('public.developers') IS NOT NULL THEN
        ALTER TABLE public.webhooks
          ADD CONSTRAINT webhooks_developer_id_fkey
          FOREIGN KEY (developer_id)
          REFERENCES public.developers(id)
          ON DELETE CASCADE
          NOT VALID;

        SELECT COUNT(*) INTO v_orphans
          FROM public.webhooks AS w
          LEFT JOIN public.developers AS d ON d.id = w.developer_id
         WHERE w.developer_id IS NOT NULL AND d.id IS NULL;

        IF v_orphans = 0 THEN
          ALTER TABLE public.webhooks VALIDATE CONSTRAINT webhooks_developer_id_fkey;
        ELSE
          RAISE WARNING
            'webhook self-heal: webhooks_developer_id_fkey left NOT VALID - % historical webhook row(s) have no public.developers owner. Rows kept for operator repair; new writes are enforced.',
            v_orphans;
        END IF;
      ELSE
        RAISE WARNING 'webhook self-heal: public.developers is missing - webhooks_developer_id_fkey intentionally NOT created (no valid owner table). New inserts will not be blocked by a stale FK.';
      END IF;

      CREATE INDEX IF NOT EXISTS idx_webhooks_developer_id ON public.webhooks(developer_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'webhook self-heal: developer_id ownership repair failed (%: %)', SQLSTATE, SQLERRM;
    END;
  END IF;

  -- ── 4. api_key_id: bound to public.api_keys ────────────────────────
  SELECT attnum::smallint INTO v_attnum
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.webhooks'::regclass
     AND attname = 'api_key_id'
     AND NOT attisdropped;

  IF v_attnum IS NOT NULL AND to_regclass('public.api_keys') IS NOT NULL THEN
    BEGIN
      FOR v_fk IN
        SELECT conname
          FROM pg_catalog.pg_constraint
         WHERE conrelid = 'public.webhooks'::regclass
           AND contype = 'f'
           AND conkey = ARRAY[v_attnum]::smallint[]
      LOOP
        EXECUTE format('ALTER TABLE public.webhooks DROP CONSTRAINT %I', v_fk.conname);
      END LOOP;

      ALTER TABLE public.webhooks
        ADD CONSTRAINT webhooks_api_key_id_fkey
        FOREIGN KEY (api_key_id)
        REFERENCES public.api_keys(id)
        ON DELETE SET NULL
        NOT VALID;

      SELECT COUNT(*) INTO v_orphans
        FROM public.webhooks AS w
        LEFT JOIN public.api_keys AS k ON k.id = w.api_key_id
       WHERE w.api_key_id IS NOT NULL AND k.id IS NULL;

      IF v_orphans = 0 THEN
        ALTER TABLE public.webhooks VALIDATE CONSTRAINT webhooks_api_key_id_fkey;
      ELSE
        RAISE WARNING 'webhook self-heal: webhooks_api_key_id_fkey left NOT VALID (% orphan rows)', v_orphans;
      END IF;

      CREATE INDEX IF NOT EXISTS idx_webhooks_api_key_id ON public.webhooks(api_key_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'webhook self-heal: api_key_id repair failed (%: %)', SQLSTATE, SQLERRM;
    END;
  END IF;

  -- ── 5. owner discriminator CHECK ───────────────────────────────────
  -- Every webhook is owned by exactly one principal kind. 'system' rows carry
  -- neither id, which is what lets staff-only and platform-only webhooks
  -- exist without abusing developer_id (the 23503 on AML registrations).
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.webhooks'::regclass
         AND conname = 'webhooks_owner_check'
    ) THEN
      ALTER TABLE public.webhooks
        ADD CONSTRAINT webhooks_owner_check CHECK (
          (owner_type = 'developer' AND developer_id IS NOT NULL)
          OR (owner_type = 'staff' AND compliance_staff_id IS NOT NULL)
          OR (owner_type = 'system')
        ) NOT VALID;

      BEGIN
        ALTER TABLE public.webhooks VALIDATE CONSTRAINT webhooks_owner_check;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'webhook self-heal: webhooks_owner_check left NOT VALID - some historical rows have no owner';
      END;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'webhook self-heal: webhooks_owner_check skipped (%: %)', SQLSTATE, SQLERRM;
  END;

  -- ── 6. staff ownership ─────────────────────────────────────────────
  -- compliance.staff is owned by the AML/compliance-stack migrations, not by
  -- this module: bind the FK when that table exists, and when it does not
  -- leave compliance_staff_id a plain UUID so staff webhooks still persist
  -- instead of 500ing on a missing relation.
  BEGIN
    IF to_regclass('compliance.staff') IS NOT NULL THEN
      SELECT attnum::smallint INTO v_attnum
        FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.webhooks'::regclass
         AND attname = 'compliance_staff_id'
         AND NOT attisdropped;

      IF v_attnum IS NOT NULL THEN
        FOR v_fk IN
          SELECT conname
            FROM pg_catalog.pg_constraint
           WHERE conrelid = 'public.webhooks'::regclass
             AND contype = 'f'
             AND conkey = ARRAY[v_attnum]::smallint[]
             AND confrelid <> 'compliance.staff'::regclass
        LOOP
          EXECUTE format('ALTER TABLE public.webhooks DROP CONSTRAINT %I', v_fk.conname);
        END LOOP;

        IF NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_constraint
           WHERE conrelid = 'public.webhooks'::regclass
             AND conname = 'webhooks_compliance_staff_id_fkey'
        ) THEN
          ALTER TABLE public.webhooks
            ADD CONSTRAINT webhooks_compliance_staff_id_fkey
            FOREIGN KEY (compliance_staff_id)
            REFERENCES compliance.staff(id)
            ON DELETE CASCADE
            NOT VALID;

          -- Same discipline as the developer FK: only enforce what the data can
          -- satisfy, so a staff row deleted outside the app (or imported without
          -- one) degrades to a warning instead of blocking the repair.
          SELECT COUNT(*) INTO v_orphans
            FROM public.webhooks AS w
            LEFT JOIN compliance.staff AS s ON s.id = w.compliance_staff_id
           WHERE w.compliance_staff_id IS NOT NULL AND s.id IS NULL;

          IF v_orphans = 0 THEN
            ALTER TABLE public.webhooks VALIDATE CONSTRAINT webhooks_compliance_staff_id_fkey;
          ELSE
            RAISE WARNING
              'webhook self-heal: webhooks_compliance_staff_id_fkey left NOT VALID - % webhook row(s) reference a missing compliance.staff member',
              v_orphans;
          END IF;
        END IF;
      END IF;
    ELSE
      RAISE NOTICE 'webhook self-heal: compliance.staff missing - staff-owned webhooks allowed without an FK (apply the compliance-stack migrations to bind it)';
    END IF;

    CREATE INDEX IF NOT EXISTS idx_webhooks_compliance_staff_id
      ON public.webhooks(compliance_staff_id)
      WHERE compliance_staff_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_webhooks_owner_type ON public.webhooks(owner_type);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'webhook self-heal: staff ownership repair failed (%: %)', SQLSTATE, SQLERRM;
  END;

  -- ── 7. legacy uuid_generate_v4() defaults ──────────────────────────
  -- src/sql/schema.sql and migration 20260319 defaulted ids to
  -- uuid_generate_v4(), which needs the uuid-ossp extension. On stock Postgres
  -- that extension is usually absent, so an INSERT without an id fails with
  -- 42883 - a second, independent "webhooks don't work" symptom.
  FOR v_fk IN
    SELECT c.relname AS table_name, a.attname AS column_name
      FROM pg_catalog.pg_attrdef d
      JOIN pg_catalog.pg_class c ON c.oid = d.adrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
     WHERE n.nspname = 'public'
       AND c.relname IN ('webhooks','webhook_deliveries')
       AND pg_catalog.pg_get_expr(d.adbin, d.adrelid) LIKE '%uuid_generate_v4%'
  LOOP
    IF to_regprocedure('uuid_generate_v4()') IS NULL THEN
      BEGIN
        EXECUTE format(
          'ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT gen_random_uuid()',
          v_fk.table_name, v_fk.column_name
        );
        RAISE NOTICE 'webhook self-heal: public.%.% default switched to gen_random_uuid()', v_fk.table_name, v_fk.column_name;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'webhook self-heal: could not redefault public.%.% (%: %)', v_fk.table_name, v_fk.column_name, SQLSTATE, SQLERRM;
      END;
    END IF;
  END LOOP;

  -- ── 8. RLS policies (Supabase only) ────────────────────────────────
  -- These reference the Supabase-managed roles and auth.uid(). On stock
  -- Postgres the roles do not exist, and before 68 that error aborted the
  -- migration - the structural repair never landed. Guarded, so the shape is
  -- fixed regardless and the policy pass only runs where it can.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role')
     AND to_regprocedure('auth.uid()') IS NOT NULL THEN
    BEGIN
      DROP POLICY IF EXISTS developers_own_webhooks ON public.webhooks;
      CREATE POLICY developers_own_webhooks ON public.webhooks FOR ALL TO authenticated
        USING (developer_id = auth.uid())
        WITH CHECK (developer_id = auth.uid());

      DROP POLICY IF EXISTS staff_own_webhooks ON public.webhooks;
      CREATE POLICY staff_own_webhooks ON public.webhooks FOR ALL TO authenticated
        USING (compliance_staff_id = auth.uid() OR owner_type = 'system')
        WITH CHECK (compliance_staff_id = auth.uid() OR owner_type = 'system');

      DROP POLICY IF EXISTS service_role_all_webhooks ON public.webhooks;
      CREATE POLICY service_role_all_webhooks ON public.webhooks FOR ALL TO service_role
        USING (true) WITH CHECK (true);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'webhook self-heal: RLS policies skipped (%: %)', SQLSTATE, SQLERRM;
    END;
  END IF;
END
$kabila_webhook_owner_schema$;`;

/**
 * The delivery log, provisioned the same way (Kuita creates both tables in one
 * constructor). `20260319_add_webhook_deliveries.sql` requires the table for
 * every delivery record, and `62`/`69` relax it for KYB and AML subjects - a
 * database that skipped those three files cannot log a single delivery, which
 * is why "no deliveries" and "no webhooks" show up as one bug.
 */
export const WEBHOOK_DELIVERIES_SCHEMA_SQL = `DO $kabila_webhook_deliveries_schema$
DECLARE
  v_attnum  smallint;
  v_fk      record;
BEGIN
  CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id              UUID NOT NULL,
    verification_request_id UUID,
    business_session_id     UUID,
    aml_screening_reference TEXT,
    payload                 JSONB NOT NULL DEFAULT '{}'::jsonb,
    status                  VARCHAR(20) NOT NULL DEFAULT 'pending',
    response_status         INTEGER,
    response_body           TEXT,
    attempts                INTEGER DEFAULT 0,
    next_retry_at           TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    delivered_at            TIMESTAMPTZ
  );

  ALTER TABLE public.webhook_deliveries
    ADD COLUMN IF NOT EXISTS business_session_id     UUID,
    ADD COLUMN IF NOT EXISTS aml_screening_reference TEXT,
    ADD COLUMN IF NOT EXISTS next_retry_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS delivered_at            TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS attempts                INTEGER DEFAULT 0;

  -- A person verification and a business session are different subjects;
  -- neither exists for a staff/system webhook. Exactly one, or none - never
  -- two, which is what the pre-62 table forbade.
  ALTER TABLE public.webhook_deliveries ALTER COLUMN verification_request_id DROP NOT NULL;

  BEGIN
    IF to_regclass('public.webhooks') IS NOT NULL THEN
      SELECT attnum::smallint INTO v_attnum
        FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.webhook_deliveries'::regclass
         AND attname = 'webhook_id'
         AND NOT attisdropped;

      IF v_attnum IS NOT NULL THEN
        FOR v_fk IN
          SELECT conname
            FROM pg_catalog.pg_constraint
           WHERE conrelid = 'public.webhook_deliveries'::regclass
             AND contype = 'f'
             AND conkey = ARRAY[v_attnum]::smallint[]
             AND confrelid <> 'public.webhooks'::regclass
        LOOP
          EXECUTE format('ALTER TABLE public.webhook_deliveries DROP CONSTRAINT %I', v_fk.conname);
        END LOOP;

        IF NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_constraint
           WHERE conrelid = 'public.webhook_deliveries'::regclass
             AND conname = 'webhook_deliveries_webhook_id_fkey'
        ) THEN
          ALTER TABLE public.webhook_deliveries
            ADD CONSTRAINT webhook_deliveries_webhook_id_fkey
            FOREIGN KEY (webhook_id)
            REFERENCES public.webhooks(id)
            ON DELETE CASCADE
            NOT VALID;
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'webhook self-heal: webhook_deliveries -> webhooks FK skipped (%: %)', SQLSTATE, SQLERRM;
  END;

  BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.webhook_deliveries'::regclass
         AND conname = 'webhook_deliveries_subject_check'
    ) THEN
      ALTER TABLE public.webhook_deliveries DROP CONSTRAINT webhook_deliveries_subject_check;
    END IF;

    ALTER TABLE public.webhook_deliveries
      ADD CONSTRAINT webhook_deliveries_subject_check CHECK (
        (verification_request_id IS NOT NULL AND business_session_id IS NULL AND aml_screening_reference IS NULL)
        OR (verification_request_id IS NULL AND business_session_id IS NOT NULL AND aml_screening_reference IS NULL)
        OR (verification_request_id IS NULL AND business_session_id IS NULL AND aml_screening_reference IS NOT NULL)
        OR (verification_request_id IS NULL AND business_session_id IS NULL AND aml_screening_reference IS NULL)
      ) NOT VALID;

    BEGIN
      ALTER TABLE public.webhook_deliveries VALIDATE CONSTRAINT webhook_deliveries_subject_check;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'webhook self-heal: webhook_deliveries_subject_check left NOT VALID (historical rows violate the relaxed subject check)';
    END;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'webhook self-heal: webhook_deliveries subject check skipped (%: %)', SQLSTATE, SQLERRM;
  END;

  CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON public.webhook_deliveries(webhook_id);
  CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_verification ON public.webhook_deliveries(verification_request_id);
  CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_business ON public.webhook_deliveries(business_session_id);
  CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON public.webhook_deliveries(status);
  CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_aml_ref
    ON public.webhook_deliveries(aml_screening_reference)
    WHERE aml_screening_reference IS NOT NULL;
END
$kabila_webhook_deliveries_schema$;`;
