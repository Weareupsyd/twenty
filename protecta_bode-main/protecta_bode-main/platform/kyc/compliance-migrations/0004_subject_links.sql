-- Identity linking (same person across KYC + screening) and KYB UBO fan-out.
CREATE TABLE IF NOT EXISTS compliance.subject_links (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kyc_user_id         UUID,
    verification_id     UUID,
    screening_ref       TEXT,
    full_name           TEXT,
    date_of_birth       TEXT,
    country             TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subject_links_kyc_idx ON compliance.subject_links (kyc_user_id);
CREATE INDEX IF NOT EXISTS subject_links_screen_idx ON compliance.subject_links (screening_ref);

CREATE TABLE IF NOT EXISTS compliance.ubo_links (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_session_id TEXT NOT NULL,
    person_name         TEXT NOT NULL,
    role_tags           TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    ownership_pct       NUMERIC,
    screening_ref       TEXT,
    verification_id     UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ubo_links_business_idx ON compliance.ubo_links (business_session_id);
