-- Phase 5 - cutover journal. Safe to re-run.
-- Python / Celery are decommissioned; dual-write triggers stay so any
-- leftover writes into public.aml_screenings still land in aml.*.

INSERT INTO compliance.migration_runs (phase, mode, report, passed, finished_at)
SELECT
    '5',
    'cutover',
    jsonb_build_object(
        'via', '0008_phase5.sql',
        'api_images', 1,
        'api_containers', 1,
        'python', 'decommissioned'
    ),
    true,
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM compliance.migration_runs
    WHERE phase = '5' AND mode = 'cutover'
);
