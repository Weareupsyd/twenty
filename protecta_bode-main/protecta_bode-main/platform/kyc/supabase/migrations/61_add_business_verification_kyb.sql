-- Business Verification (KYB)
--
-- Adds the business-session surface alongside the existing person-scoped
-- verification_requests. A business session owns:
--   • an extracted company profile           (business_sessions)
--   • the people who own and run the company (business_key_people)
--   • constitutive documents + OCR fields    (business_documents)
--   • entity and per-person AML results      (business_aml_screenings)
--   • a field-level cross-check ledger       (business_cross_checks)
--
-- Design notes
--   • Role tags are canonical and enumerated (15 of them). A person can carry
--     several, so tags live in a text[] rather than a single column.
--   • A key person that requires KYC points at a normal verification_requests
--     row via linked_kyc_session_id - same orchestrator, same audit trail.
--     That is a plain FK, so the existing person pipeline is reused unchanged.
--   • Statuses are stored uppercase to match the public API contract
--     (NOT_STARTED / IN_PROGRESS / AWAITING_USER / IN_REVIEW / RESUBMITTED /
--     APPROVED / DECLINED). A CHECK constraint keeps casing honest.
--   • This release is document-first: registry_* columns exist and stay NULL
--     until the registry connector is enabled. Nothing reads them yet, so
--     turning the connector on is additive rather than a schema change.

-- ── Session ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    developer_id UUID REFERENCES developers(id) ON DELETE CASCADE,

    -- Public identifiers
    session_number BIGSERIAL,
    vendor_data VARCHAR(255),
    workflow_id VARCHAR(120),

    -- Lifecycle
    status VARCHAR(20) NOT NULL DEFAULT 'NOT_STARTED',
    previous_status VARCHAR(20),
    decision_reason TEXT,
    decided_at TIMESTAMP WITH TIME ZONE,
    decided_by UUID,

    -- Hosted flow access (hashed, never stored raw - mirrors handoff tokens)
    access_token_hash TEXT,
    access_token_expires_at TIMESTAMP WITH TIME ZONE,

    -- Company profile, as extracted from the submitted documents
    legal_name VARCHAR(255),
    registration_number VARCHAR(120),
    company_type VARCHAR(120),
    incorporation_date DATE,
    jurisdiction VARCHAR(120),
    registered_address TEXT,
    tax_number VARCHAR(120),
    company_status VARCHAR(60),

    -- What the administrator typed, kept separate from what we extracted so
    -- the cross-check can compare the two without one overwriting the other.
    user_provided_data JSONB DEFAULT '{}'::jsonb,
    extracted_data JSONB DEFAULT '{}'::jsonb,

    -- Registry connector - deferred this release, populated later.
    registry_data JSONB,
    registry_checked_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT business_sessions_status_check CHECK (status IN (
        'NOT_STARTED','IN_PROGRESS','AWAITING_USER','IN_REVIEW',
        'RESUBMITTED','APPROVED','DECLINED'
    ))
);

CREATE INDEX IF NOT EXISTS idx_business_sessions_developer ON business_sessions(developer_id);
CREATE INDEX IF NOT EXISTS idx_business_sessions_status ON business_sessions(status);
CREATE INDEX IF NOT EXISTS idx_business_sessions_vendor ON business_sessions(vendor_data);
CREATE INDEX IF NOT EXISTS idx_business_sessions_created ON business_sessions(created_at DESC);

-- ── Key people ─────────────────────────────────────────────────────────────
-- One row per person or corporate entity tied to the business.
CREATE TABLE IF NOT EXISTS business_key_people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_session_id UUID REFERENCES business_sessions(id) ON DELETE CASCADE,

    full_name VARCHAR(255) NOT NULL,
    date_of_birth DATE,
    nationality VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(40),

    -- Canonical role tags; one person can carry several.
    role_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    ownership_percentage NUMERIC(6,3),
    voting_percentage NUMERIC(6,3),

    -- Corporate owners resolve through their own nested business session.
    is_corporate BOOLEAN DEFAULT FALSE,
    nested_business_session_id UUID REFERENCES business_sessions(id) ON DELETE SET NULL,

    -- Where this person came from: 'registry' | 'document' | 'user_provided'
    source VARCHAR(30) DEFAULT 'user_provided',

    -- Linked person KYC. Reuses verification_requests unchanged.
    kyc_required BOOLEAN DEFAULT FALSE,
    linked_kyc_session_id UUID REFERENCES verification_requests(id) ON DELETE SET NULL,
    kyc_status VARCHAR(20),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT business_key_people_ownership_range
        CHECK (ownership_percentage IS NULL OR (ownership_percentage >= 0 AND ownership_percentage <= 100)),
    CONSTRAINT business_key_people_voting_range
        CHECK (voting_percentage IS NULL OR (voting_percentage >= 0 AND voting_percentage <= 100))
);

CREATE INDEX IF NOT EXISTS idx_business_key_people_session ON business_key_people(business_session_id);
CREATE INDEX IF NOT EXISTS idx_business_key_people_kyc ON business_key_people(linked_kyc_session_id);
CREATE INDEX IF NOT EXISTS idx_business_key_people_tags ON business_key_people USING GIN (role_tags);

-- ── Documents ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_session_id UUID REFERENCES business_sessions(id) ON DELETE CASCADE,

    document_type VARCHAR(60) NOT NULL,
    file_path TEXT,
    file_name VARCHAR(255),
    file_size INTEGER,
    mime_type VARCHAR(100),

    ocr_data JSONB DEFAULT '{}'::jsonb,
    ocr_confidence NUMERIC(4,3),
    fields_expected INTEGER,
    fields_extracted INTEGER,

    tamper_check_passed BOOLEAN,
    tamper_notes TEXT,

    -- 'PENDING' | 'PROCESSED' | 'FLAGGED'
    status VARCHAR(20) DEFAULT 'PENDING',

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_documents_session ON business_documents(business_session_id);
CREATE INDEX IF NOT EXISTS idx_business_documents_type ON business_documents(document_type);

-- ── AML ────────────────────────────────────────────────────────────────────
-- Entity screening (key_person_id NULL) and per-person screening share a table
-- so the review surface can read one ordered list.
CREATE TABLE IF NOT EXISTS business_aml_screenings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_session_id UUID REFERENCES business_sessions(id) ON DELETE CASCADE,
    key_person_id UUID REFERENCES business_key_people(id) ON DELETE CASCADE,

    -- 'entity' | 'person'
    subject_type VARCHAR(20) NOT NULL,
    screened_name VARCHAR(255) NOT NULL,

    risk_level VARCHAR(30),
    match_found BOOLEAN DEFAULT FALSE,
    matches JSONB DEFAULT '[]'::jsonb,
    lists_checked JSONB DEFAULT '[]'::jsonb,

    screened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT business_aml_subject_check CHECK (subject_type IN ('entity','person'))
);

CREATE INDEX IF NOT EXISTS idx_business_aml_session ON business_aml_screenings(business_session_id);
CREATE INDEX IF NOT EXISTS idx_business_aml_person ON business_aml_screenings(key_person_id);

-- ── Cross-check ledger ─────────────────────────────────────────────────────
-- One row per field compared. Keeping this as rows rather than a JSON blob
-- means the review table renders straight from a query, and an analyst can
-- see exactly which source disagreed.
CREATE TABLE IF NOT EXISTS business_cross_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_session_id UUID REFERENCES business_sessions(id) ON DELETE CASCADE,

    field_name VARCHAR(80) NOT NULL,
    values_by_source JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- 'MATCH' | 'INCONSISTENT' | 'UNCORROBORATED' | 'DEFERRED'
    result VARCHAR(20) NOT NULL,
    detail TEXT,
    sources_compared INTEGER DEFAULT 0,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT business_cross_checks_result_check
        CHECK (result IN ('MATCH','INCONSISTENT','UNCORROBORATED','DEFERRED'))
);

CREATE INDEX IF NOT EXISTS idx_business_cross_checks_session ON business_cross_checks(business_session_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Mirrors migration 57: service_role gets ALL; authenticated developers read
-- only their own rows. Child tables scope through the parent session.
ALTER TABLE business_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_key_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_aml_screenings ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_cross_checks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN

    DROP POLICY IF EXISTS service_role_all_business_sessions ON public.business_sessions;
    CREATE POLICY service_role_all_business_sessions ON public.business_sessions
      FOR ALL TO service_role USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS developers_own_business_sessions ON public.business_sessions;
    CREATE POLICY developers_own_business_sessions ON public.business_sessions
      FOR SELECT TO authenticated USING (developer_id = auth.uid());

    DROP POLICY IF EXISTS service_role_all_business_key_people ON public.business_key_people;
    CREATE POLICY service_role_all_business_key_people ON public.business_key_people
      FOR ALL TO service_role USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS developers_own_business_key_people ON public.business_key_people;
    CREATE POLICY developers_own_business_key_people ON public.business_key_people
      FOR SELECT TO authenticated USING (business_session_id IN (
        SELECT id FROM business_sessions WHERE developer_id = auth.uid()));

    DROP POLICY IF EXISTS service_role_all_business_documents ON public.business_documents;
    CREATE POLICY service_role_all_business_documents ON public.business_documents
      FOR ALL TO service_role USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS developers_own_business_documents ON public.business_documents;
    CREATE POLICY developers_own_business_documents ON public.business_documents
      FOR SELECT TO authenticated USING (business_session_id IN (
        SELECT id FROM business_sessions WHERE developer_id = auth.uid()));

    DROP POLICY IF EXISTS service_role_all_business_aml ON public.business_aml_screenings;
    CREATE POLICY service_role_all_business_aml ON public.business_aml_screenings
      FOR ALL TO service_role USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS developers_own_business_aml ON public.business_aml_screenings;
    CREATE POLICY developers_own_business_aml ON public.business_aml_screenings
      FOR SELECT TO authenticated USING (business_session_id IN (
        SELECT id FROM business_sessions WHERE developer_id = auth.uid()));

    DROP POLICY IF EXISTS service_role_all_business_cross_checks ON public.business_cross_checks;
    CREATE POLICY service_role_all_business_cross_checks ON public.business_cross_checks
      FOR ALL TO service_role USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS developers_own_business_cross_checks ON public.business_cross_checks;
    CREATE POLICY developers_own_business_cross_checks ON public.business_cross_checks
      FOR SELECT TO authenticated USING (business_session_id IN (
        SELECT id FROM business_sessions WHERE developer_id = auth.uid()));

  END IF;
END $$;
