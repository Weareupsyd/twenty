import { describe, expect, it } from 'vitest';
import { shortRef, parseDisplayRef, isUuid } from '../ids.js';
import {
  compareIdentity,
  fieldMatch,
  inferDecision,
  mapScreeningLabel,
  mapVerificationLabel,
  normalizeDecision,
  planFanout,
  riskScore,
  shapeMatch,
  toSummary,
} from '../shape.js';

describe('ids', () => {
  it('is deterministic', () => {
    const a = shortRef('SUB', '11111111-1111-4111-8111-111111111111');
    const b = shortRef('SUB', '11111111-1111-4111-8111-111111111111');
    expect(a).toBe(b);
    expect(a.startsWith('SUB-')).toBe(true);
    expect(a.length).toBe(9);
  });

  it('parses display refs', () => {
    expect(parseDisplayRef('sub-90411')).toEqual({ prefix: 'SUB', digits: '90411' });
    expect(parseDisplayRef('nope')).toBeNull();
  });

  it('detects uuids', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isUuid('SUB-90411')).toBe(false);
  });
});

describe('labels', () => {
  it('maps verification statuses', () => {
    expect(mapVerificationLabel('verified')).toBe('passed');
    expect(mapVerificationLabel('manual_review')).toBe('review');
    expect(mapVerificationLabel('failed')).toBe('failed');
  });

  it('maps screening labels', () => {
    expect(mapScreeningLabel({ riskLevel: 'Clear', matchFound: false })).toBe('clear');
    expect(mapScreeningLabel({ riskLevel: 'High', matchFound: true, topics: ['pep'] })).toBe('PEP match');
    expect(mapScreeningLabel({ riskLevel: 'Critical', matchFound: true, topics: ['sanction'] })).toBe('sanctions');
    expect(mapScreeningLabel({})).toBe('not run');
  });

  it('infers decision from evidence', () => {
    expect(inferDecision({ recorded: 'approve' })).toBe('approved');
    expect(inferDecision({ verification: 'failed' })).toBe('rejected');
    expect(inferDecision({ verification: 'verified', screening: 'clear' })).toBe('approved');
    expect(inferDecision({ screening: 'sanctions' })).toBe('in review');
  });

  it('normalizes decision verbs', () => {
    expect(normalizeDecision('Approved')).toBe('approve');
    expect(normalizeDecision('DECLINED')).toBe('reject');
    expect(normalizeDecision('escalate')).toBe('escalate');
    expect(() => normalizeDecision('maybe')).toThrow(/approve/);
  });
});

describe('identity + matches', () => {
  it('compares submitted vs extracted', () => {
    const fields = compareIdentity({
      submitted: { full_name: 'Mohamed Abdi Farah', date_of_birth: '1984-03-11' },
      extracted: { full_name: 'MOHAMED ABDI FARAH', date_of_birth: '1984-03-11' },
    });
    const name = fields.find((f) => f.field === 'Full name');
    expect(name?.match).toBe('exact');
    expect(fieldMatch('Kenya', 'KE')).toBe('mismatch');
  });

  it('shapes a yente hit', () => {
    const shaped = shapeMatch({
      entity_id: 'Q-PEP-1',
      caption: 'Mohamed Abdi Farah',
      score: 0.93,
      topics: ['pep'],
      datasets: ['peps'],
    });
    expect(shaped.type).toBe('PEP');
    expect(shaped.disposition).toBe('review');
  });

  it('converts max score to 0-100', () => {
    expect(riskScore(0.71)).toBe(71);
    expect(riskScore(94)).toBe(94);
    expect(riskScore(null)).toBeNull();
  });
});

describe('fan-out plan', () => {
  it('screens the company then every key person', () => {
    const plan = planFanout(
      { legal_name: 'Nile Trading FZE', jurisdiction: 'AE' },
      [
        { id: '1', full_name: 'Yasser Al-Mansoori', role_tags: ['director', 'ubo'], ownership_percentage: 45 },
        { id: '2', full_name: 'Nile Holdings Ltd', is_corporate: true, role_tags: ['shareholder'], ownership_percentage: 20 },
      ],
    );
    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({ kind: 'company', name: 'Nile Trading FZE' });
    expect(plan[1].kind).toBe('person');
    expect(plan[2].kind).toBe('company');
  });
});

describe('summary row', () => {
  it('builds a subject list row', () => {
    const row = toSummary({
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'individual',
      name: 'Mohamed A. Farah',
      country: 'Somalia',
      verificationStatus: 'verified',
      screeningRisk: 'High',
      matchFound: true,
      topics: ['pep'],
      maxScore: 0.71,
      submittedAt: '2026-08-17T08:58:00Z',
    });
    expect(row.verification).toBe('passed');
    expect(row.screening).toBe('PEP match');
    expect(row.decision).toBe('in review');
    expect(row.risk).toBe(71);
    expect(row.ref.startsWith('SUB-')).toBe(true);
  });
});
