-- ── KYB workflows ──────────────────────────────────────────────────────────
--
-- Until now `workflow_id` was free text on business_sessions: a label with no
-- table behind it. That was fine while every session behaved identically, but
-- nested ownership resolution changes verdicts, so which behaviour applies has
-- to be a per-workflow decision rather than one process-wide env var.
--
-- Design notes:
--
--   • workflow_id stays free text on business_sessions and there is NO foreign
--     key to this table. Sessions created before this migration reference
--     workflows that do not exist, and an integrator may invent a workflow_id
--     at call time. A missing row is a normal state meaning "use the
--     deployment defaults", not an error.
--
--   • Settings are nullable on purpose. NULL means "inherit the deployment
--     default"; TRUE/FALSE mean the workflow has an opinion. A plain BOOLEAN
--     DEFAULT FALSE could not express "no opinion", which would force every
--     workflow to re-state the default and silently freeze it in place.
--
--   • Scoped per developer. Two developers may both have a workflow called
--     "standard" and they must not collide or read each other's settings.

CREATE TABLE IF NOT EXISTS kyb_workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,

    -- The free-text key already stored on business_sessions.workflow_id.
    workflow_id VARCHAR(120) NOT NULL,
    name VARCHAR(200),
    description TEXT,

    -- Feature switches. NULL = inherit the deployment default.
    nested_ownership_enabled BOOLEAN,
    auto_approve_when_clean BOOLEAN,

    -- NULL = use DEFAULT_REQUIRED_DOCUMENTS. An empty array is a real setting
    -- meaning "require nothing", which is why this is not NOT NULL.
    required_documents TEXT[],

    -- Ownership threshold for beneficial-owner classification. NULL = the FATF
    -- 25% convention. Some regimes use 10%.
    ubo_threshold_percentage NUMERIC(5,2)
        CHECK (ubo_threshold_percentage IS NULL
               OR (ubo_threshold_percentage > 0 AND ubo_threshold_percentage <= 100)),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT kyb_workflows_developer_workflow_key UNIQUE (developer_id, workflow_id)
);

-- The hot path is "resolve this session's workflow_id for this developer",
-- which the UNIQUE constraint above already indexes. This one covers listing a
-- developer's workflows in the dashboard.
CREATE INDEX IF NOT EXISTS idx_kyb_workflows_developer
    ON kyb_workflows(developer_id, is_active);

COMMENT ON TABLE kyb_workflows IS
    'Per-workflow KYB behaviour. A missing row means deployment defaults apply.';
COMMENT ON COLUMN kyb_workflows.nested_ownership_enabled IS
    'NULL inherits KYB_NESTED_OWNERSHIP. TRUE resolves corporate owners into child sessions; FALSE records them without resolving.';
COMMENT ON COLUMN kyb_workflows.required_documents IS
    'NULL inherits DEFAULT_REQUIRED_DOCUMENTS. An empty array genuinely requires no documents.';
