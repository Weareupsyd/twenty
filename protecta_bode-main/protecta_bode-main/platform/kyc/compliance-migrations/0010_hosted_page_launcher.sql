-- Hosted-page launcher bootstrap.
--
-- The combined staff console creates tokenized verification sessions by API-key
-- ID; it never needs or exposes a plaintext key. Seed one dedicated developer
-- and an unguessable, server-only key hash so a fresh self-hosted install can
-- generate its first QR without requiring a second developer-portal signup.
--
-- This migration is applied once before and once after Kabila's own migrations
-- during a fresh deployment, so it must be a no-op until the public tables and
-- the service-key columns exist.
DO $$
DECLARE
  hosted_developer_id UUID;
BEGIN
  IF to_regclass('public.developers') IS NULL
     OR to_regclass('public.api_keys') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'is_service'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'developers' AND column_name = 'page_builder_config'
     ) THEN
    RETURN;
  END IF;

  INSERT INTO public.developers (
    email, name, company, status, is_verified, verification_slug,
    page_builder_config, created_at, updated_at
  ) VALUES (
    'service+hosted-pages@kabila.app',
    'Hosted Verification',
    'Kabila Compliance',
    'active',
    TRUE,
    NULL,
    jsonb_build_object(
      'headerTitle', 'Verify Your Identity',
      'headerSubtitle', 'Complete the steps below to verify your identity',
      'showPoweredBy', TRUE,
      'theme', 'dark',
      'backgroundColor', '#080c14',
      'cardBackgroundColor', '#0f1420',
      'textColor', '#dde2ec',
      'accentColor', '#00F0FF',
      'mutedTextColor', '#8a8a90',
      'borderColor', '#1e1e22',
      'fontFamily', 'dm-sans',
      'steps', jsonb_build_object(
        'front', jsonb_build_object('enabled', TRUE, 'label', 'Front of ID'),
        'back', jsonb_build_object('enabled', TRUE, 'label', 'Back of ID'),
        'liveness', jsonb_build_object('enabled', TRUE, 'label', 'Live Capture')
      ),
      'completionTitle', 'Verification Complete',
      'completionMessage', 'Your identity has been successfully verified.',
      'showConfetti', FALSE,
      'verificationMode', 'full',
      'ageThreshold', 18
    ),
    NOW(),
    NOW()
  )
  ON CONFLICT (email) DO UPDATE SET
    status = 'active',
    page_builder_config = COALESCE(developers.page_builder_config, EXCLUDED.page_builder_config),
    updated_at = NOW()
  RETURNING id INTO hosted_developer_id;

  IF hosted_developer_id IS NULL THEN
    SELECT id INTO hosted_developer_id
      FROM public.developers
     WHERE email = 'service+hosted-pages@kabila.app';
  END IF;

  INSERT INTO public.api_keys (
    developer_id, key_hash, key_prefix, name,
    is_sandbox, is_active, is_service, created_at
  )
  SELECT
    hosted_developer_id,
    md5(random()::text || clock_timestamp()::text || hosted_developer_id::text)
      || md5(gen_random_uuid()::text || random()::text),
    'hosted_',
    'Hosted page launcher (server-only)',
    FALSE,
    TRUE,
    FALSE,
    NOW()
  WHERE hosted_developer_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.api_keys
       WHERE developer_id = hosted_developer_id
         AND name = 'Hosted page launcher (server-only)'
    );
END $$;
