-- Persist screening policy (thresholds + corridor overrides).
-- Matches the former SQLAlchemy aml.system_settings shape so ON CONFLICT (key) works.
CREATE TABLE IF NOT EXISTS aml.system_settings (
    id          SERIAL PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    value       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO aml.system_settings (key, value, updated_at)
VALUES
    ('screening.thresholds', jsonb_build_object('global_threshold', 0.82), NOW()),
    ('corridors.overrides', jsonb_build_object('overrides', '[]'::jsonb), NOW())
ON CONFLICT (key) DO NOTHING;
