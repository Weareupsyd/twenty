-- ─────────────────────────────────────────────────────────────────────────────
-- External correlation metadata for the Odoo KYC/AML webhook integration.
--
-- Odoo initialises verification sessions and later matches webhook callbacks
-- back to its own records (res.partner / guarantor / lead). It sends an opaque
-- correlation reference plus subject metadata. We store it verbatim on the
-- verification row so that:
--   1. every webhook event echoes it back unchanged;
--   2. it survives the hosted-link hop (the reference lives on the session,
--      not on the URL);
--   3. it is searchable from the Compliance admin portal.
--
-- All columns are nullable and additive - existing clients and existing rows
-- are unaffected. Identifiers are treated as opaque strings, never integers,
-- so we deliberately do NOT depend on an Odoo integer ID for matching.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE verification_requests
  ADD COLUMN IF NOT EXISTS external_reference TEXT,
  ADD COLUMN IF NOT EXISTS external_system    TEXT,
  ADD COLUMN IF NOT EXISTS subject_type       TEXT,
  ADD COLUMN IF NOT EXISTS odoo_partner_id    TEXT,
  ADD COLUMN IF NOT EXISTS odoo_guarantor_id  TEXT,
  ADD COLUMN IF NOT EXISTS odoo_lead_id       TEXT,
  ADD COLUMN IF NOT EXISTS external_user_id   TEXT;

-- Search index for the admin portal's subject lookup (external_reference is
-- the primary correlation key Odoo operators will paste into the console).
CREATE INDEX IF NOT EXISTS verification_requests_external_reference_idx
  ON verification_requests (external_reference)
  WHERE external_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS verification_requests_subject_type_idx
  ON verification_requests (subject_type)
  WHERE subject_type IS NOT NULL;

COMMENT ON COLUMN verification_requests.external_reference IS
  'Opaque correlation reference supplied by the external system (e.g. odoo-kyc-case-123). Echoed unchanged on every webhook event.';
COMMENT ON COLUMN verification_requests.external_system IS
  'Name of the external system that initialised this verification (e.g. odoo).';
COMMENT ON COLUMN verification_requests.subject_type IS
  'Subject type: customer | guarantor | business_director | beneficial_owner | individual.';
COMMENT ON COLUMN verification_requests.odoo_partner_id IS
  'Odoo res.partner id (opaque string) when the subject is a customer.';
COMMENT ON COLUMN verification_requests.odoo_guarantor_id IS
  'Odoo guarantor record id (opaque string) when the subject is a guarantor.';
COMMENT ON COLUMN verification_requests.odoo_lead_id IS
  'Odoo loan/opportunity id (opaque string) linking the case to the opportunity.';
COMMENT ON COLUMN verification_requests.external_user_id IS
  'Opaque external subject id supplied at initialization (e.g. stable-external-subject-id). Echoed verbatim as webhook user_id; the UUID user_id column holds the internal users FK.';
