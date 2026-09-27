/**
 * KYB domain tests - role tags, cross-check, aggregation, webhook signing.
 *
 * These cover the parts that decide whether a company gets onboarded, so the
 * cases here are mostly about the awkward paths: a person wearing several
 * hats, documents that disagree, a child KYC that never comes back, and a
 * signature that must survive re-serialisation.
 */

import { describe, it, expect } from 'vitest';

import {
  ROLE_TAGS,
  ROLE_TAG_COUNT,
  normalizeRoleTag,
  normalizeRoleTags,
  personRequiresKyc,
  personRequiresNestedKyb,
  requirementFor,
  type RoleTag,
} from '../roleTags.js';

import {
  checkField,
  runCrossCheck,
  normalizeCompanyName,
  normalizeDate,
  normalizeRegistrationNumber,
} from '../crossCheck.js';

import { aggregate, summariseChildKyc, totalOwnership, toPercent, peopleNeedingKyc } from '../aggregation.js';

import {
  sortKeys,
  shortenFloats,
  canonicalize,
  signPayload,
  verifyRawSignature,
  buildBusinessPayload,
  isBusinessEvent,
} from '../businessWebhook.js';

// ── Role tags ──────────────────────────────────────────────────────────────
describe('role tags', () => {
  it('defines exactly 15 canonical tags', () => {
    expect(ROLE_TAG_COUNT).toBe(15);
  });

  it('splits them across ownership and governance', () => {
    const ownership = ROLE_TAGS.filter((r) => r.group === 'ownership');
    const governance = ROLE_TAGS.filter((r) => r.group === 'governance');
    expect(ownership.length).toBeGreaterThan(0);
    expect(governance.length).toBeGreaterThan(0);
    expect(ownership.length + governance.length).toBe(15);
  });

  it('maps registry and free-text wording onto canonical tags', () => {
    expect(normalizeRoleTag('Managing Director')).toBe('director');
    expect(normalizeRoleTag('Company Secretary')).toBe('secretary');
    expect(normalizeRoleTag('Ultimate Beneficial Owner')).toBe('ubo');
    expect(normalizeRoleTag('authorised signatory')).toBe('signatory');
    expect(normalizeRoleTag('CHAIRPERSON')).toBe('chairman');
    expect(normalizeRoleTag('legal_representative')).toBe('legal_representative');
  });

  it('reports unmappable roles instead of guessing', () => {
    const { tags, unmapped } = normalizeRoleTags(['Director', 'Grand Vizier']);
    expect(tags).toEqual(['director']);
    expect(unmapped).toEqual(['Grand Vizier']);
  });

  it('de-duplicates synonyms landing on the same tag', () => {
    const { tags } = normalizeRoleTags(['Director', 'board member', 'Managing Director']);
    expect(tags).toEqual(['director']);
  });

  it('spawns ONE session for a person wearing several required hats', () => {
    const tags: RoleTag[] = ['ubo', 'shareholder', 'director', 'signatory'];
    expect(personRequiresKyc(tags)).toBe(true);
    const people = [{ id: '1', full_name: 'Amina', role_tags: tags }];
    expect(peopleNeedingKyc(people)).toHaveLength(1);
  });

  it('treats a corporate owner as nested KYB, not person KYC', () => {
    expect(personRequiresNestedKyb(['corporate_owner'])).toBe(true);
    expect(personRequiresKyc(['corporate_owner'])).toBe(false);
  });

  it('lets a workflow policy override the default requirement', () => {
    expect(requirementFor('secretary')).toBe('optional');
    expect(requirementFor('secretary', { secretary: 'required' })).toBe('required');
    expect(personRequiresKyc(['secretary'])).toBe(false);
    expect(personRequiresKyc(['secretary'], { secretary: 'required' })).toBe(true);
  });

  it('does not require KYC when the only required tag is switched off', () => {
    expect(personRequiresKyc(['ubo'], { ubo: 'off' })).toBe(false);
  });
});

// ── Cross-check normalisation ──────────────────────────────────────────────
describe('cross-check normalisation', () => {
  it('treats Ltd and Limited as the same company', () => {
    expect(normalizeCompanyName('Acme Logistics Kenya Limited'))
      .toBe(normalizeCompanyName('Acme Logistics Kenya Ltd'));
  });

  it('ignores punctuation in registration numbers', () => {
    expect(normalizeRegistrationNumber('PVT-4XKJ8R2')).toBe(normalizeRegistrationNumber('pvt4xkj8r2'));
  });

  it('reconciles date formats, day-first', () => {
    expect(normalizeDate('2018-03-06')).toBe('2018-03-06');
    expect(normalizeDate('06/03/2018')).toBe('2018-03-06');
    expect(normalizeDate('6 March 2018')).toBe('2018-03-06');
    expect(normalizeDate('March 6, 2018')).toBe('2018-03-06');
  });
});

// ── Cross-check results ────────────────────────────────────────────────────
describe('cross-check', () => {
  it('MATCHes when two documents agree', () => {
    const r = checkField('legal_name', [
      { source: 'certificate', kind: 'document', value: 'Acme Logistics Kenya Limited' },
      { source: 'articles', kind: 'document', value: 'Acme Logistics Kenya Ltd' },
    ]);
    expect(r.result).toBe('MATCH');
    expect(r.sources_compared).toBe(2);
  });

  it('flags INCONSISTENT when a document and the administrator disagree', () => {
    const r = checkField('registered_address', [
      { source: 'certificate', kind: 'document', value: 'Enterprise Rd, Industrial Area, Nairobi' },
      { source: 'user_provided', kind: 'user_provided', value: 'Mombasa Rd, Nairobi' },
    ]);
    expect(r.result).toBe('INCONSISTENT');
    expect(r.detail).toContain('disagree');
  });

  it('does NOT pass a field the administrator alone asserted', () => {
    const r = checkField('tax_number', [
      { source: 'user_provided', kind: 'user_provided', value: 'P051XXXXXX9J' },
    ]);
    expect(r.result).toBe('UNCORROBORATED');
  });

  it('does NOT pass a field only one document mentions', () => {
    const r = checkField('company_type', [
      { source: 'certificate', kind: 'document', value: 'Private company limited by shares' },
    ]);
    expect(r.result).toBe('UNCORROBORATED');
  });

  it('records DEFERRED when nothing supplied a value', () => {
    const r = checkField('tax_number', [
      { source: 'certificate', kind: 'document', value: null },
    ]);
    expect(r.result).toBe('DEFERRED');
  });

  it('marks the registry column deferred while the connector is off', () => {
    const checks = runCrossCheck({
      documents: {
        certificate_of_incorporation: { legal_name: 'Acme Logistics Kenya Limited' },
        articles_of_association: { legal_name: 'Acme Logistics Kenya Ltd' },
      },
      userProvided: { legal_name: 'Acme Logistics Kenya Ltd' },
    });
    const name = checks.find((c) => c.field === 'legal_name')!;
    expect(name.result).toBe('MATCH');
    expect(name.values_by_source.registry).toBeNull();
  });

  it('uses the registry as another source once supplied', () => {
    const checks = runCrossCheck({
      documents: { certificate_of_incorporation: { registration_number: 'PVT-1' } },
      userProvided: {},
      registry: { registration_number: 'PVT-2' },
    });
    expect(checks.find((c) => c.field === 'registration_number')!.result).toBe('INCONSISTENT');
  });
});

// ── Aggregation ────────────────────────────────────────────────────────────
const REQUIRED_DOCS = ['certificate_of_incorporation'];

function baseInput(overrides: Partial<Parameters<typeof aggregate>[0]> = {}) {
  return {
    keyPeople: [],
    documents: [{ document_type: 'certificate_of_incorporation', status: 'PROCESSED', tamper_check_passed: true }],
    requiredDocumentTypes: REQUIRED_DOCS,
    crossCheckResults: ['MATCH' as const],
    entityAmlRisk: 'clear' as const,
    ...overrides,
  };
}

describe('business verdict aggregation', () => {
  it('waits on the applicant while a required document is missing', () => {
    const out = aggregate(baseInput({ documents: [] }));
    expect(out.status).toBe('AWAITING_USER');
    expect(out.reasons.map((r) => r.code)).toContain('DOCUMENTS_MISSING');
  });

  it('does not issue a verdict until every required child KYC resolves', () => {
    const out = aggregate(baseInput({
      keyPeople: [
        { id: '1', full_name: 'Amina', role_tags: ['ubo'], ownership_percentage: 100, kyc_status: 'APPROVED' },
        { id: '2', full_name: 'Joseph', role_tags: ['director'], kyc_status: 'IN_PROGRESS' },
      ],
    }));
    expect(out.status).toBe('AWAITING_USER');
    expect(out.ubo_kyc_summary).toMatchObject({ required: 2, approved: 1, pending: 1 });
  });

  it('approves once everything is clean and resolved', () => {
    const out = aggregate(baseInput({
      keyPeople: [
        { id: '1', full_name: 'Amina', role_tags: ['ubo'], ownership_percentage: 100, kyc_status: 'APPROVED', aml_risk_level: 'clear' },
      ],
    }));
    expect(out.status).toBe('APPROVED');
    expect(out.ownership_reconciles).toBe(true);
  });

  it('declines on a confirmed sanctions match against the entity', () => {
    const out = aggregate(baseInput({ entityAmlRisk: 'confirmed_match' }));
    expect(out.status).toBe('DECLINED');
    expect(out.reasons[0].code).toBe('AML_CONFIRMED_MATCH');
  });

  it('declines on a confirmed sanctions match against any key person', () => {
    const out = aggregate(baseInput({
      keyPeople: [
        { id: '1', full_name: 'Amina', role_tags: ['ubo'], ownership_percentage: 100, kyc_status: 'APPROVED', aml_risk_level: 'confirmed_match' },
      ],
    }));
    expect(out.status).toBe('DECLINED');
  });

  it('declines when a required child KYC was declined', () => {
    const out = aggregate(baseInput({
      keyPeople: [
        { id: '1', full_name: 'Amina', role_tags: ['ubo'], ownership_percentage: 100, kyc_status: 'DECLINED' },
      ],
    }));
    expect(out.status).toBe('DECLINED');
    expect(out.reasons[0].code).toBe('LINKED_KYC_DECLINED');
  });

  it('sanctions decline beats a still-pending child - no waiting to say no', () => {
    const out = aggregate(baseInput({
      entityAmlRisk: 'confirmed_match',
      keyPeople: [{ id: '1', full_name: 'A', role_tags: ['ubo'], ownership_percentage: 100, kyc_status: 'IN_PROGRESS' }],
    }));
    expect(out.status).toBe('DECLINED');
  });

  it('routes a PEP signal to review rather than approving', () => {
    const out = aggregate(baseInput({
      keyPeople: [
        { id: '1', full_name: 'Peter', role_tags: ['chairman'], ownership_percentage: 100, kyc_status: 'APPROVED', aml_risk_level: 'potential_match' },
      ],
    }));
    expect(out.status).toBe('IN_REVIEW');
    expect(out.reasons.map((r) => r.code)).toContain('AML_POTENTIAL_MATCH');
  });

  it('routes a cross-check inconsistency to review', () => {
    const out = aggregate(baseInput({ crossCheckResults: ['MATCH', 'INCONSISTENT'] }));
    expect(out.status).toBe('IN_REVIEW');
    expect(out.reasons.map((r) => r.code)).toContain('CROSS_CHECK_INCONSISTENT');
  });

  it('blocks approval when ownership does not reach 100%', () => {
    const out = aggregate(baseInput({
      keyPeople: [
        { id: '1', full_name: 'Amina', role_tags: ['ubo'], ownership_percentage: 52, kyc_status: 'APPROVED' },
      ],
    }));
    expect(out.status).toBe('IN_REVIEW');
    expect(out.reasons.map((r) => r.code)).toContain('OWNERSHIP_UNRECONCILED');
  });

  it('tolerates rounding in split ownership', () => {
    const people = [
      { id: '1', full_name: 'A', role_tags: ['ubo' as RoleTag], ownership_percentage: 33.333, kyc_status: 'APPROVED' },
      { id: '2', full_name: 'B', role_tags: ['ubo' as RoleTag], ownership_percentage: 33.333, kyc_status: 'APPROVED' },
      { id: '3', full_name: 'C', role_tags: ['ubo' as RoleTag], ownership_percentage: 33.334, kyc_status: 'APPROVED' },
    ];
    expect(totalOwnership(people)).toBeCloseTo(100, 2);
    expect(aggregate(baseInput({ keyPeople: people })).status).toBe('APPROVED');
  });

  it('holds a clean session for sign-off when auto-approve is disabled', () => {
    const out = aggregate(baseInput({
      keyPeople: [{ id: '1', full_name: 'A', role_tags: ['ubo'], ownership_percentage: 100, kyc_status: 'APPROVED' }],
      options: { autoApproveWhenClean: false },
    }));
    expect(out.status).toBe('IN_REVIEW');
    expect(out.reasons[0].code).toBe('MANUAL_SIGNOFF_REQUIRED');
  });

  it('flags a tampered document', () => {
    const out = aggregate(baseInput({
      documents: [{ document_type: 'certificate_of_incorporation', status: 'PROCESSED', tamper_check_passed: false }],
      keyPeople: [{ id: '1', full_name: 'A', role_tags: ['ubo'], ownership_percentage: 100, kyc_status: 'APPROVED' }],
    }));
    expect(out.status).toBe('IN_REVIEW');
    expect(out.reasons.map((r) => r.code)).toContain('DOCUMENT_TAMPER');
  });


  // Regression: Postgres NUMERIC arrives as a string ("52.000"), not a number.
  // Before this was handled, every percentage was discarded, ownership never
  // reconciled, and a clean company sat in review forever. Caught by running
  // against a real database rather than a mock.
  describe('NUMERIC from Postgres', () => {
    it('coerces string percentages', () => {
      expect(toPercent('52.000')).toBe(52);
      expect(toPercent(52)).toBe(52);
      expect(toPercent(null)).toBeNull();
      expect(toPercent('')).toBeNull();
      expect(toPercent('not-a-number')).toBeNull();
    });

    it('totals ownership when the driver returns strings', () => {
      const people = [
        { id: '1', full_name: 'A', role_tags: ['ubo' as RoleTag], ownership_percentage: '52.000' },
        { id: '2', full_name: 'B', role_tags: ['ubo' as RoleTag], ownership_percentage: '28.000' },
        { id: '3', full_name: 'C', role_tags: ['ubo' as RoleTag], ownership_percentage: '20.000' },
      ];
      expect(totalOwnership(people as never)).toBe(100);
    });

    it('approves a clean session whose percentages came back as strings', () => {
      const out = aggregate(baseInput({
        keyPeople: [{
          id: '1', full_name: 'A', role_tags: ['ubo'],
          ownership_percentage: '100.000' as never, kyc_status: 'APPROVED',
        }],
      }));
      expect(out.ownership_total).toBe(100);
      expect(out.ownership_reconciles).toBe(true);
      expect(out.status).toBe('APPROVED');
    });
  });

  it('counts a multi-tag person once in the KYC summary', () => {
    const summary = summariseChildKyc([
      { id: '1', full_name: 'Amina', role_tags: ['ubo', 'shareholder', 'director'], kyc_status: 'APPROVED' },
    ]);
    expect(summary.required).toBe(1);
    expect(summary.approved).toBe(1);
  });
});

// ── Webhook signing ────────────────────────────────────────────────────────
describe('X-Signature-V2', () => {
  const secret = 'whsec_test_shared_key';

  it('sorts keys recursively before signing', () => {
    expect(sortKeys({ b: 1, a: { d: 2, c: 3 } })).toEqual({ a: { c: 3, d: 2 }, b: 1 });
  });

  it('preserves array order - order is data', () => {
    expect(sortKeys({ xs: [3, 1, 2] })).toEqual({ xs: [3, 1, 2] });
  });

  it('shortens trailing zeros, including OCR/NUMERIC strings', () => {
    expect(shortenFloats(25.0)).toBe(25);
    expect(shortenFloats('25.00')).toBe('25');
    expect(shortenFloats({ pct: '52.500' })).toEqual({ pct: '52.5' });
  });

  it('produces the same signature regardless of key order', () => {
    const a = { event: 'business.status.updated', data: { status: 'APPROVED', session_id: 'bs_1' } };
    const b = { data: { session_id: 'bs_1', status: 'APPROVED' }, event: 'business.status.updated' };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(signPayload(a, secret)).toBe(signPayload(b, secret));
  });

  it('emits a 64-char hex digest', () => {
    expect(signPayload({ a: 1 }, secret)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies against the exact raw bytes as sent', () => {
    const payload = { event: 'business.status.updated', data: { session_id: 'bs_1' } };
    const raw = Buffer.from(JSON.stringify(payload));
    const sig = require('crypto').createHmac('sha256', secret).update(raw).digest('hex');
    expect(verifyRawSignature(raw, sig, secret)).toBe(true);
  });

  it('still verifies when the sender canonicalised but transmitted differently', () => {
    const payload = { b: 2, a: 1 };
    const sig = signPayload(payload, secret);
    const rawDifferentOrder = Buffer.from('{"b":2,"a":1}');
    expect(verifyRawSignature(rawDifferentOrder, sig, secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = signPayload({ amount: 1 }, secret);
    expect(verifyRawSignature(Buffer.from('{"amount":1000000}'), sig, secret)).toBe(false);
  });

  it('rejects the wrong secret, a missing header and a malformed digest', () => {
    const raw = Buffer.from('{"a":1}');
    const sig = signPayload({ a: 1 }, secret);
    expect(verifyRawSignature(raw, sig, 'wrong_secret')).toBe(false);
    expect(verifyRawSignature(raw, undefined, secret)).toBe(false);
    expect(verifyRawSignature(raw, 'not-hex', secret)).toBe(false);
  });

  it('accepts an optional sha256= prefix', () => {
    const payload = { a: 1 };
    const raw = Buffer.from(JSON.stringify(payload));
    const sig = require('crypto').createHmac('sha256', secret).update(raw).digest('hex');
    expect(verifyRawSignature(raw, `sha256=${sig}`, secret)).toBe(true);
  });

  it('builds a payload carrying session_kind business, and routes on it', () => {
    const p = buildBusinessPayload({
      event: 'business.status.updated',
      applicationId: 'app_abc123',
      sessionId: 'bs_01H',
      vendorData: 'biz-acme-001',
      status: 'APPROVED',
      previousStatus: 'IN_PROGRESS',
    });
    expect(p.data.session_kind).toBe('business');
    expect(p.data.business_session_id).toBe('bs_01H');
    expect(isBusinessEvent(p)).toBe(true);
    expect(isBusinessEvent({ data: { session_kind: 'user' } })).toBe(false);
  });
});
