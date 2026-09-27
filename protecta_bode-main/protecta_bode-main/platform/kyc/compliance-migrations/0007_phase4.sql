-- Phase 4 - dual-write bookkeeping + idempotent historical backfill.
-- Safe to re-run. Does nothing if source tables are not there yet.

-- ── Journal ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance.migration_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phase           TEXT NOT NULL DEFAULT '4',
    mode            TEXT NOT NULL DEFAULT 'apply',
    report          JSONB NOT NULL DEFAULT '{}'::jsonb,
    passed          BOOLEAN,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ
);

-- Dedup indexes so backfill / dual-write can ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS subject_links_verification_screen_uidx
    ON compliance.subject_links (verification_id, screening_ref)
    WHERE verification_id IS NOT NULL AND screening_ref IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ubo_links_business_person_screen_uidx
    ON compliance.ubo_links (business_session_id, person_name, screening_ref)
    WHERE screening_ref IS NOT NULL;

-- ── Extra columns on aml.screening_requests (created by SQLAlchemy) ──────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'aml' AND table_name = 'screening_requests'
    ) THEN
        ALTER TABLE aml.screening_requests
            ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'aml';
        ALTER TABLE aml.screening_requests
            ADD COLUMN IF NOT EXISTS kabila_screening_id UUID;
        ALTER TABLE aml.screening_requests
            ADD COLUMN IF NOT EXISTS verification_id UUID;
        ALTER TABLE aml.screening_requests
            ADD COLUMN IF NOT EXISTS business_session_id TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS screening_requests_kabila_id_uidx
            ON aml.screening_requests (kabila_screening_id)
            WHERE kabila_screening_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS screening_requests_verification_idx
            ON aml.screening_requests (verification_id)
            WHERE verification_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS screening_requests_source_idx
            ON aml.screening_requests (source);
    END IF;
END $$;

-- ── Dual-write triggers (parallel-run window) ────────────────────────────
CREATE OR REPLACE FUNCTION compliance.mirror_kabila_aml()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    ref TEXT;
    risk TEXT;
BEGIN
    IF to_regclass('aml.screening_requests') IS NULL THEN
        RETURN NEW;
    END IF;
    ref := 'SCR-KAB-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 10));
    risk := CASE lower(COALESCE(NEW.risk_level, 'clear'))
        WHEN 'clear' THEN 'Clear'
        WHEN 'potential_match' THEN 'Medium'
        WHEN 'confirmed_match' THEN 'High'
        WHEN 'low' THEN 'Low'
        WHEN 'medium' THEN 'Medium'
        WHEN 'high' THEN 'High'
        WHEN 'critical' THEN 'Critical'
        ELSE initcap(COALESCE(NEW.risk_level, 'Clear'))
    END;
    INSERT INTO aml.screening_requests (
        reference, request_type, status, input_name, input_payload,
        yente_result, risk_level, match_classification, match_found,
        max_score, processing_ms, requested_by, created_at,
        source, kabila_screening_id, verification_id
    ) VALUES (
        ref, 'person', 'completed', NEW.full_name,
        jsonb_build_object(
            'name', NEW.full_name,
            'date_of_birth', NEW.date_of_birth,
            'nationality', NEW.nationality,
            'source', 'kabila'
        ),
        jsonb_build_object('matches', COALESCE(NEW.matches, '[]'::jsonb)),
        risk,
        jsonb_build_object('sanctions', NEW.match_found),
        NEW.match_found,
        CASE WHEN NEW.match_found THEN 0.85 ELSE 0.10 END,
        0, 'kabila-addon', COALESCE(NEW.screened_at, NOW()),
        'kabila', NEW.id, NEW.verification_request_id
    )
    ON CONFLICT DO NOTHING;

    IF NEW.verification_request_id IS NOT NULL THEN
        INSERT INTO compliance.subject_links (
            kyc_user_id, verification_id, screening_ref, full_name,
            date_of_birth, country
        )
        SELECT vr.user_id, NEW.verification_request_id, ref, NEW.full_name,
               NEW.date_of_birth, NEW.nationality
        FROM public.verification_requests vr
        WHERE vr.id = NEW.verification_request_id
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'mirror_kabila_aml skipped: %', SQLERRM;
    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF to_regclass('public.aml_screenings') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS trg_mirror_kabila_aml ON public.aml_screenings;
        CREATE TRIGGER trg_mirror_kabila_aml
            AFTER INSERT ON public.aml_screenings
            FOR EACH ROW EXECUTE FUNCTION compliance.mirror_kabila_aml();
    END IF;
END $$;

CREATE OR REPLACE FUNCTION compliance.mirror_kyb_aml()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    ref TEXT;
    risk TEXT;
    kind TEXT;
BEGIN
    IF to_regclass('aml.screening_requests') IS NULL THEN
        RETURN NEW;
    END IF;
    ref := 'SCR-KYB-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 10));
    kind := CASE WHEN NEW.subject_type = 'entity' THEN 'company' ELSE 'person' END;
    risk := CASE lower(COALESCE(NEW.risk_level, 'clear'))
        WHEN 'clear' THEN 'Clear'
        WHEN 'potential_match' THEN 'Medium'
        WHEN 'confirmed_match' THEN 'High'
        WHEN 'low' THEN 'Low'
        WHEN 'medium' THEN 'Medium'
        WHEN 'high' THEN 'High'
        WHEN 'critical' THEN 'Critical'
        ELSE initcap(COALESCE(NEW.risk_level, 'Clear'))
    END;
    INSERT INTO aml.screening_requests (
        reference, request_type, status, input_name, input_payload,
        yente_result, risk_level, match_classification, match_found,
        max_score, processing_ms, requested_by, created_at,
        source, kabila_screening_id, business_session_id
    ) VALUES (
        ref, kind, 'completed', NEW.screened_name,
        jsonb_build_object('name', NEW.screened_name, 'source', 'kabila-kyb', 'subject_type', NEW.subject_type),
        jsonb_build_object('matches', COALESCE(NEW.matches, '[]'::jsonb)),
        risk,
        jsonb_build_object('sanctions', NEW.match_found),
        NEW.match_found,
        CASE WHEN NEW.match_found THEN 0.85 ELSE 0.10 END,
        0, 'kabila-kyb', COALESCE(NEW.screened_at, NOW()),
        'kabila-kyb', NEW.id, NEW.business_session_id::text
    )
    ON CONFLICT DO NOTHING;

    INSERT INTO compliance.ubo_links (
        business_session_id, person_name, role_tags, screening_ref
    ) VALUES (
        NEW.business_session_id::text, NEW.screened_name, ARRAY[]::text[], ref
    )
    ON CONFLICT DO NOTHING;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'mirror_kyb_aml skipped: %', SQLERRM;
    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF to_regclass('public.business_aml_screenings') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS trg_mirror_kyb_aml ON public.business_aml_screenings;
        CREATE TRIGGER trg_mirror_kyb_aml
            AFTER INSERT ON public.business_aml_screenings
            FOR EACH ROW EXECUTE FUNCTION compliance.mirror_kyb_aml();
    END IF;
END $$;

-- Link a native AML/TS screening to a KYC subject when the name matches.
CREATE OR REPLACE FUNCTION compliance.link_native_screening()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.source IN ('kabila', 'kabila-kyb') THEN
        RETURN NEW;
    END IF;
    INSERT INTO compliance.subject_links (
        kyc_user_id, verification_id, screening_ref, full_name
    )
    SELECT vr.user_id, vr.id, NEW.reference, NEW.input_name
    FROM public.verification_requests vr
    LEFT JOIN LATERAL (
        SELECT ocr_data FROM public.documents d
        WHERE d.verification_request_id = vr.id
        ORDER BY d.created_at ASC LIMIT 1
    ) doc ON true
    WHERE regexp_replace(lower(btrim(COALESCE(
            vr.ocr_data->>'full_name', vr.ocr_data->>'name',
            doc.ocr_data->>'full_name', doc.ocr_data->>'name', ''
          ))), '[^a-z0-9]+', ' ', 'g')
        = regexp_replace(lower(btrim(NEW.input_name)), '[^a-z0-9]+', ' ', 'g')
      AND regexp_replace(lower(btrim(NEW.input_name)), '[^a-z0-9]+', ' ', 'g') <> ''
    ON CONFLICT DO NOTHING;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'link_native_screening skipped: %', SQLERRM;
    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF to_regclass('aml.screening_requests') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS trg_link_native_screening ON aml.screening_requests;
        CREATE TRIGGER trg_link_native_screening
            AFTER INSERT ON aml.screening_requests
            FOR EACH ROW EXECUTE FUNCTION compliance.link_native_screening();
    END IF;
END $$;

-- ── Historical backfill (idempotent) ─────────────────────────────────────
DO $$
BEGIN
    IF to_regclass('public.aml_screenings') IS NOT NULL
       AND to_regclass('aml.screening_requests') IS NOT NULL THEN
        INSERT INTO aml.screening_requests (
            reference, request_type, status, input_name, input_payload,
            yente_result, risk_level, match_classification, match_found,
            max_score, processing_ms, requested_by, created_at,
            source, kabila_screening_id, verification_id
        )
        SELECT
            'SCR-KAB-' || upper(substr(replace(a.id::text, '-', ''), 1, 10)),
            'person', 'completed', a.full_name,
            jsonb_build_object('name', a.full_name, 'date_of_birth', a.date_of_birth,
                               'nationality', a.nationality, 'source', 'kabila'),
            jsonb_build_object('matches', COALESCE(a.matches, '[]'::jsonb)),
            CASE lower(COALESCE(a.risk_level, 'clear'))
                WHEN 'clear' THEN 'Clear'
                WHEN 'potential_match' THEN 'Medium'
                WHEN 'confirmed_match' THEN 'High'
                WHEN 'low' THEN 'Low'
                WHEN 'medium' THEN 'Medium'
                WHEN 'high' THEN 'High'
                WHEN 'critical' THEN 'Critical'
                ELSE initcap(COALESCE(a.risk_level, 'Clear'))
            END,
            jsonb_build_object('sanctions', a.match_found),
            a.match_found,
            CASE WHEN a.match_found THEN 0.85 ELSE 0.10 END,
            0, 'kabila-addon', COALESCE(a.screened_at, NOW()),
            'kabila', a.id, a.verification_request_id
        FROM public.aml_screenings a
        ON CONFLICT DO NOTHING;

        INSERT INTO compliance.subject_links (
            kyc_user_id, verification_id, screening_ref, full_name, date_of_birth, country
        )
        SELECT vr.user_id, a.verification_request_id,
               'SCR-KAB-' || upper(substr(replace(a.id::text, '-', ''), 1, 10)),
               a.full_name, a.date_of_birth, a.nationality
        FROM public.aml_screenings a
        LEFT JOIN public.verification_requests vr ON vr.id = a.verification_request_id
        WHERE a.verification_request_id IS NOT NULL
        ON CONFLICT DO NOTHING;
    END IF;

    IF to_regclass('public.business_aml_screenings') IS NOT NULL
       AND to_regclass('aml.screening_requests') IS NOT NULL THEN
        INSERT INTO aml.screening_requests (
            reference, request_type, status, input_name, input_payload,
            yente_result, risk_level, match_classification, match_found,
            max_score, processing_ms, requested_by, created_at,
            source, kabila_screening_id, business_session_id
        )
        SELECT
            'SCR-KYB-' || upper(substr(replace(b.id::text, '-', ''), 1, 10)),
            CASE WHEN b.subject_type = 'entity' THEN 'company' ELSE 'person' END,
            'completed', b.screened_name,
            jsonb_build_object('name', b.screened_name, 'source', 'kabila-kyb'),
            jsonb_build_object('matches', COALESCE(b.matches, '[]'::jsonb)),
            CASE lower(COALESCE(b.risk_level, 'clear'))
                WHEN 'clear' THEN 'Clear'
                WHEN 'potential_match' THEN 'Medium'
                WHEN 'confirmed_match' THEN 'High'
                ELSE initcap(COALESCE(b.risk_level, 'Clear'))
            END,
            jsonb_build_object('sanctions', b.match_found),
            b.match_found,
            CASE WHEN b.match_found THEN 0.85 ELSE 0.10 END,
            0, 'kabila-kyb', COALESCE(b.screened_at, NOW()),
            'kabila-kyb', b.id, b.business_session_id::text
        FROM public.business_aml_screenings b
        ON CONFLICT DO NOTHING;

        INSERT INTO compliance.ubo_links (
            business_session_id, person_name, role_tags, screening_ref, verification_id
        )
        SELECT b.business_session_id::text, b.screened_name, ARRAY[]::text[],
               'SCR-KYB-' || upper(substr(replace(b.id::text, '-', ''), 1, 10)),
               kp.linked_kyc_session_id
        FROM public.business_aml_screenings b
        LEFT JOIN public.business_key_people kp ON kp.id = b.key_person_id
        ON CONFLICT DO NOTHING;
    END IF;

    IF to_regclass('aml.users') IS NOT NULL THEN
        INSERT INTO compliance.staff (
            email, full_name, hashed_password, whatsapp_number,
            aml_role, kyc_role, readonly, is_active, scopes, aml_user_id
        )
        SELECT
            lower(u.email), COALESCE(u.full_name, ''), u.hashed_password, u.whatsapp_number,
            COALESCE(u.role, 'analyst'),
            CASE WHEN lower(COALESCE(u.role, '')) IN ('superuser', 'admin') THEN 'admin' ELSE 'reviewer' END,
            lower(COALESCE(u.role, '')) = 'auditor',
            COALESCE(u.is_active, true),
            ARRAY['kyc', 'aml']::text[],
            u.id
        FROM aml.users u
        WHERE u.email IS NOT NULL
        ON CONFLICT (email) DO UPDATE SET
            aml_user_id = COALESCE(compliance.staff.aml_user_id, EXCLUDED.aml_user_id),
            hashed_password = COALESCE(compliance.staff.hashed_password, EXCLUDED.hashed_password),
            whatsapp_number = COALESCE(compliance.staff.whatsapp_number, EXCLUDED.whatsapp_number),
            updated_at = NOW();
    END IF;
END $$;
