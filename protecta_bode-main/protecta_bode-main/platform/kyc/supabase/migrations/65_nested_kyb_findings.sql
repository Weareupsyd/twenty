-- ── Nested KYB findings ────────────────────────────────────────────────────
--
-- When nested KYB refuses to open a child session for a corporate owner -
-- because the chain loops back on itself, or is deeper than the ceiling - that
-- refusal is a finding about the ownership structure, not a transient
-- scheduling detail.
--
-- Until now it was returned once in the HTTP response to whoever submitted the
-- key people, and then lost. The analyst who reviews the company hours later
-- had no way to learn that a circular ownership structure had been detected;
-- the corporate owner simply sat there unresolved with no explanation.
--
-- Deliberately its own table rather than a column on business_key_people:
-- a finding is an event with a time and a reason, several can accumulate for
-- one owner across re-submissions, and none of them should overwrite each
-- other.

CREATE TABLE IF NOT EXISTS business_nested_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    business_session_id UUID NOT NULL REFERENCES business_sessions(id) ON DELETE CASCADE,
    -- The corporate owner we declined to resolve. SET NULL rather than CASCADE:
    -- if the person row is later removed, the fact that a circular structure
    -- was detected is still worth keeping.
    key_person_id UUID REFERENCES business_key_people(id) ON DELETE SET NULL,

    -- Denormalised so the finding stays readable after the person row changes.
    owner_name VARCHAR(255) NOT NULL,

    -- 'CIRCULAR_OWNERSHIP' | 'MAX_DEPTH_EXCEEDED'
    finding_type VARCHAR(40) NOT NULL,
    detail TEXT NOT NULL,

    -- Cleared when an analyst has dealt with it, so findings can be listed as
    -- outstanding without being deleted.
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID,

    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_nested_findings_session
    ON business_nested_findings(business_session_id);

-- One open finding per owner per type: re-submitting the same key people must
-- not pile up duplicates of the same structural problem.
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_nested_findings_unique_open
    ON business_nested_findings(business_session_id, owner_name, finding_type)
    WHERE resolved_at IS NULL;

COMMENT ON TABLE business_nested_findings IS
    'Corporate owners nested KYB refused to resolve (cycle or depth ceiling). Kept so an analyst reviewing later can see why an owner is unresolved.';
