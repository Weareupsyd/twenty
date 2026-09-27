/**
 * Canonical catalog of webhook event types.
 * Both the backend (event filtering, validation) and the frontend
 * (event checklist with descriptions) should reference this list.
 */
export const WEBHOOK_EVENTS: Record<string, string> = {
  'verification.initialized':        'Verification session initialised by an external system (correlation metadata accepted)',
  'verification.started':            'Verification session created',
  'verification.document_processed': 'Document step completed (front or back)',
  'verification.completed':          'Verification passed',
  'verification.failed':             'Verification rejected',
  'verification.manual_review':      'Flagged for manual review',
  'verification.expired':            'Verification session expired before completion',
  'screening.completed':             'AML/sanctions screening finished (clear, medium, or high risk)',
  'screening.hit':                   'AML/sanctions screening returned one or more matches',
  'document.expiry_warning':         'Document nearing or past expiry date',
  'verification.reverification_due': 'Scheduled re-verification is due',

  // Business (KYB) sessions. Signed with X-Signature-V2 over the canonicalised
  // payload, and carrying session_kind: 'business' plus business_session_id -
  // route on session_kind so these reach the KYB handler.
  'business.status.updated':         'Business session status changed',
  'business.data.updated':           'Business session data submitted or changed',

  // AML / compliance-staff events. Fired by aml/webhooks.ts for staff-owned
  // webhooks (owner_type='staff') - screening completions and case status
  // changes. They were missing from this catalog, so createStaffWebhook
  // rejected them and staff webhooks could never subscribe to the events the
  // dispatcher actually fires (they silently defaulted to person events and
  // never matched the aml.* dispatch filter).
  'aml.screening.completed':         'AML screening completed',
  'aml.case.status.updated':         'AML case status changed',
} as const;

/** Event names that describe business (KYB) sessions rather than people. */
export const BUSINESS_EVENT_NAMES = Object.keys(WEBHOOK_EVENTS).filter(e => e.startsWith('business.'));

/** All valid event names as a typed array */
export const WEBHOOK_EVENT_NAMES = Object.keys(WEBHOOK_EVENTS);

/**
 * Default subscription for a new webhook.
 *
 * Person events only. Business events are deliberately opt-in: they use a
 * different signature header and payload shape, so silently adding them to
 * every existing endpoint would send KYB payloads to receivers written only
 * for person verifications, which would fail signature verification.
 */
export const DEFAULT_WEBHOOK_EVENT_NAMES = WEBHOOK_EVENT_NAMES.filter(e => !e.startsWith('business.'));
