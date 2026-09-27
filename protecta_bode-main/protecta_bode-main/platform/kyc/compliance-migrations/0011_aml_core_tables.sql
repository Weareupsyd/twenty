-- Phase 5.1 - ported AML tables (the TypeScript port's database surface).
--
-- The retired Python service created these tables at boot via SQLAlchemy
-- `create_all()` (search_path = aml,public). The TypeScript port reads and
-- writes the same aml.* tables, but no migration ever created them, so a
-- fresh unified Postgres 500s on /api/screenings, /api/cases and
-- /api/datasets. Safe to re-run - every statement is idempotent.

-- ── screening_requests ────────────────────────────────────────────────────
-- Immutable audit trail of every screening. Mirrors the SQLAlchemy model
-- (backend-python/app/models/orm.py) plus the Phase 4 dual-write columns
-- from 0007_phase4.sql, so the TS insert paths keep working unchanged.
CREATE TABLE IF NOT EXISTS aml.screening_requests (
    id                    SERIAL PRIMARY KEY,
    reference             TEXT NOT NULL UNIQUE,
    request_type          TEXT NOT NULL DEFAULT 'auto',
    status                TEXT NOT NULL DEFAULT 'completed',
    input_name            TEXT NOT NULL,
    input_payload         JSONB,
    yente_result          JSONB,
    risk_level            TEXT NOT NULL DEFAULT 'Clear',
    match_classification  JSONB NOT NULL DEFAULT '{}'::jsonb,
    match_found           BOOLEAN NOT NULL DEFAULT FALSE,
    max_score             DOUBLE PRECISION NOT NULL DEFAULT 0,
    processing_ms         INTEGER NOT NULL DEFAULT 0,
    requested_by          TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source                TEXT NOT NULL DEFAULT 'aml',
    kabila_screening_id   UUID,
    verification_id       UUID,
    business_session_id   TEXT
);

CREATE INDEX IF NOT EXISTS screening_requests_created_idx
    ON aml.screening_requests (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS screening_requests_kabila_id_uidx
    ON aml.screening_requests (kabila_screening_id)
    WHERE kabila_screening_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS screening_requests_verification_idx
    ON aml.screening_requests (verification_id)
    WHERE verification_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS screening_requests_source_idx
    ON aml.screening_requests (source);

-- ── dataset_syncs ─────────────────────────────────────────────────────────
-- History of every dataset synchronisation run. dataset_version is NULL for
-- the default catalogue (a new row per run); per-file runs store
-- 'opensanctions_default/<file>' as the dataset_name.
CREATE TABLE IF NOT EXISTS aml.dataset_syncs (
    id              SERIAL PRIMARY KEY,
    dataset_name    TEXT NOT NULL DEFAULT 'opensanctions_default',
    dataset_version TEXT,
    status          TEXT NOT NULL DEFAULT 'running',
    entity_count    INTEGER NOT NULL DEFAULT 0,
    checksum_sha256 TEXT,
    source_url      TEXT,
    error_message   TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    UNIQUE (dataset_name, dataset_version)
);

CREATE INDEX IF NOT EXISTS dataset_syncs_started_idx
    ON aml.dataset_syncs (started_at DESC);

-- ── cases + case_notes ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aml.cases (
    id                  TEXT PRIMARY KEY,
    title               TEXT NOT NULL,
    description         TEXT,
    status              TEXT NOT NULL DEFAULT 'open',
    screening_reference TEXT REFERENCES aml.screening_requests(reference),
    created_by          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cases_updated_idx
    ON aml.cases (updated_at DESC);

CREATE TABLE IF NOT EXISTS aml.case_notes (
    id          TEXT PRIMARY KEY,
    case_id     TEXT NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    author      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS case_notes_case_idx
    ON aml.case_notes (case_id);

-- ── local enrichment (Layer B) ────────────────────────────────────────────
-- Private analyst-confirmed records, kept separate from imported
-- OpenSanctions data in Elasticsearch/yente.
CREATE TABLE IF NOT EXISTS aml.local_entities (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    entity_type  TEXT NOT NULL DEFAULT 'person',
    properties   JSONB NOT NULL DEFAULT '{}'::jsonb,
    provenance   TEXT NOT NULL,
    added_by     TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS local_entities_name_idx
    ON aml.local_entities (name);

CREATE TABLE IF NOT EXISTS aml.local_relationships (
    id                 TEXT PRIMARY KEY,
    source_entity_id   TEXT NOT NULL,
    target_entity_id   TEXT NOT NULL,
    relationship_type  TEXT NOT NULL,
    provenance         TEXT NOT NULL,
    confirmed_by       TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS local_relationships_source_idx
    ON aml.local_relationships (source_entity_id);
CREATE INDEX IF NOT EXISTS local_relationships_target_idx
    ON aml.local_relationships (target_entity_id);

-- ── hosted-pages surface columns ──────────────────────────────────────────
-- The hosted-pages console reads public.developers / public.api_keys columns
-- added by the Kabila supabase migrations (30, 40, 42, 58). Re-assert them
-- here, guarded, so a leniently-migrated public schema still serves
-- GET /api/hosted-pages instead of 500ing on a missing column.
DO $$
BEGIN
    IF to_regclass('public.developers') IS NOT NULL THEN
        ALTER TABLE public.developers
            ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
        ALTER TABLE public.developers
            ADD COLUMN IF NOT EXISTS branding_logo_url TEXT;
        ALTER TABLE public.developers
            ADD COLUMN IF NOT EXISTS page_builder_config JSONB DEFAULT NULL;
        ALTER TABLE public.developers
            ADD COLUMN IF NOT EXISTS verification_slug TEXT DEFAULT NULL;
    END IF;

    IF to_regclass('public.api_keys') IS NOT NULL THEN
        ALTER TABLE public.api_keys
            ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE public.api_keys
            ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE public.api_keys
            ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
    END IF;
END $$;
