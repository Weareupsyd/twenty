/**
 * Regression: business webhook events must be registerable.
 *
 * The KYB dispatcher emitted `business.status.updated` and
 * `business.data.updated`, but neither was in the canonical catalog. Since
 * POST /api/developer/webhooks rejects any event not in that catalog, a
 * developer could not subscribe - so `getBusinessWebhooksFor` always matched
 * zero endpoints and every business event was silently dropped.
 *
 * The whole KYB webhook path was unreachable in production, and nothing
 * failed: the dispatcher's own tests construct webhook rows directly rather
 * than going through registration, so the gap between "what we send" and "what
 * you may subscribe to" was never exercised.
 *
 * The second half matters just as much: business events must NOT be in the
 * default subscription. They use a different signature header (X-Signature-V2)
 * and payload shape, so defaulting them on would start posting KYB payloads to
 * every existing receiver written for person verifications.
 */

import { describe, it, expect } from 'vitest';
import {
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_NAMES,
  BUSINESS_EVENT_NAMES,
  DEFAULT_WEBHOOK_EVENT_NAMES,
} from '../../../constants/webhookEvents.js';
import { BUSINESS_WEBHOOK_EVENTS } from '../businessWebhook.js';

describe('webhook event catalog', () => {
  it('registers every business event the dispatcher can emit', () => {
    // The exact gap that made the KYB webhook path dead.
    for (const event of Object.keys(BUSINESS_WEBHOOK_EVENTS)) {
      expect(WEBHOOK_EVENT_NAMES).toContain(event);
    }
  });

  it('describes every registered event, so the UI checklist is never blank', () => {
    for (const name of WEBHOOK_EVENT_NAMES) {
      expect(WEBHOOK_EVENTS[name]).toBeTruthy();
    }
  });

  it('keeps the person events that already existed', () => {
    for (const event of [
      'verification.started',
      'verification.document_processed',
      'verification.completed',
      'verification.failed',
      'verification.manual_review',
      'document.expiry_warning',
      'verification.reverification_due',
    ]) {
      expect(WEBHOOK_EVENT_NAMES).toContain(event);
    }
  });
});

describe('default subscription', () => {
  it('excludes business events - they are opt-in', () => {
    // Defaulting these on would post KYB payloads, signed with a different
    // header, to receivers built only for person verifications.
    expect(DEFAULT_WEBHOOK_EVENT_NAMES.filter(e => e.startsWith('business.'))).toEqual([]);
  });

  it('still contains every person event', () => {
    const personEvents = WEBHOOK_EVENT_NAMES.filter(e => !e.startsWith('business.'));
    expect(DEFAULT_WEBHOOK_EVENT_NAMES).toEqual(personEvents);
  });

  it('is a strict subset of what may be subscribed to', () => {
    for (const e of DEFAULT_WEBHOOK_EVENT_NAMES) expect(WEBHOOK_EVENT_NAMES).toContain(e);
    expect(DEFAULT_WEBHOOK_EVENT_NAMES.length).toBeLessThan(WEBHOOK_EVENT_NAMES.length);
  });
});

describe('BUSINESS_EVENT_NAMES', () => {
  it('lists exactly the business events', () => {
    expect(BUSINESS_EVENT_NAMES.sort()).toEqual(Object.keys(BUSINESS_WEBHOOK_EVENTS).sort());
  });

  it('partitions the catalog with the defaults, losing nothing', () => {
    expect([...DEFAULT_WEBHOOK_EVENT_NAMES, ...BUSINESS_EVENT_NAMES].sort())
      .toEqual([...WEBHOOK_EVENT_NAMES].sort());
  });
});
