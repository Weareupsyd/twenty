-- Phase 3 - display refs + generated reports for the combined console.
ALTER TABLE compliance.subject_links
    ADD COLUMN IF NOT EXISTS display_ref TEXT;

CREATE INDEX IF NOT EXISTS subject_links_display_idx
    ON compliance.subject_links (display_ref)
    WHERE display_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS compliance.generated_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_type     TEXT NOT NULL,
    scope           TEXT,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    generated_by    TEXT,
    size_bytes      INTEGER,
    status          TEXT NOT NULL DEFAULT 'ready',
    display_ref     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS generated_reports_created_idx
    ON compliance.generated_reports (created_at DESC);
