-- Unified approve / reject / escalate. Written by Phase 3 endpoints;
-- created now so both runtimes share the table from day one.
CREATE TABLE IF NOT EXISTS compliance.decisions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id      TEXT,
    verification_id UUID,
    screening_ref   TEXT,
    decision        TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'escalate')),
    reason          TEXT,
    decided_by      UUID REFERENCES compliance.staff(id) ON DELETE SET NULL,
    evidence        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS decisions_subject_idx ON compliance.decisions (subject_id);
CREATE INDEX IF NOT EXISTS decisions_screening_idx ON compliance.decisions (screening_ref);
CREATE INDEX IF NOT EXISTS decisions_verification_idx ON compliance.decisions (verification_id);
