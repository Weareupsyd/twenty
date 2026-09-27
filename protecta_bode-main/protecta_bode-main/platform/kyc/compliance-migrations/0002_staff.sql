-- Merged console operators. This is NOT public.users (KYC subjects).
-- AML analyst/reviewer/superuser/auditor and Kabila admin_users land here.
CREATE TABLE IF NOT EXISTS compliance.staff (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email             TEXT NOT NULL UNIQUE,
    full_name         TEXT NOT NULL DEFAULT '',
    -- Canonical password: AML PBKDF2 (`saltHex$hashHex`). Written lazily
    -- from a bcrypt login so both hashers keep working.
    hashed_password   TEXT,
    -- Original Kabila bcrypt hash, if the row was imported from admin_users.
    bcrypt_hash       TEXT,
    whatsapp_number   TEXT,
    -- Stored AML role (analyst | reviewer | superuser | auditor).
    aml_role          TEXT NOT NULL DEFAULT 'analyst',
    -- Kabila-facing role (admin | reviewer).
    kyc_role          TEXT NOT NULL DEFAULT 'reviewer'
                      CHECK (kyc_role IN ('admin', 'reviewer')),
    readonly          BOOLEAN NOT NULL DEFAULT FALSE,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    scopes            TEXT[] NOT NULL DEFAULT ARRAY['kyc', 'aml']::text[],
    session_token     TEXT,
    session_last_active TIMESTAMPTZ,
    aml_user_id       TEXT,
    kabila_admin_id   UUID,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_whatsapp_idx
    ON compliance.staff (whatsapp_number)
    WHERE whatsapp_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS staff_session_idx
    ON compliance.staff (session_token)
    WHERE session_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS staff_aml_user_idx
    ON compliance.staff (aml_user_id)
    WHERE aml_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS compliance.password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id    UUID NOT NULL REFERENCES compliance.staff(id) ON DELETE CASCADE,
    token       TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
