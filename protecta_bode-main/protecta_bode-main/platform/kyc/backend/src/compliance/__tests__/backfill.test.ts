import { describe, expect, it } from 'vitest';
import {
  coverageVerdict,
  kabilaScreenRef,
  mapKabilaRisk,
  normalizeName,
  planKabilaCopies,
  planNameLinks,
} from '../mapping.js';

describe('mapKabilaRisk', () => {
  it('maps addon levels onto the AML risk model', () => {
    expect(mapKabilaRisk('clear')).toBe('Clear');
    expect(mapKabilaRisk('potential_match')).toBe('Medium');
    expect(mapKabilaRisk('confirmed_match')).toBe('High');
    expect(mapKabilaRisk('HIGH')).toBe('High');
  });
});

describe('normalizeName', () => {
  it('collapses punctuation and case', () => {
    expect(normalizeName('Mohamed A. Farah')).toBe('mohamed a farah');
    expect(normalizeName('  MOHAMED   A  FARAH ')).toBe('mohamed a farah');
  });
});

describe('kabilaScreenRef', () => {
  it('is deterministic', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(kabilaScreenRef(id, 'KAB')).toBe(kabilaScreenRef(id, 'KAB'));
    expect(kabilaScreenRef(id, 'KAB').startsWith('SCR-KAB-')).toBe(true);
  });
});

describe('coverageVerdict', () => {
  it('passes when every historical screen is linked', () => {
    const report = coverageVerdict({ verified: 10, historicallyScreened: 8, linked: 8 });
    expect(report.passed).toBe(true);
    expect(report.unlinked).toBe(0);
    expect(report.unscreened).toBe(2);
    expect(report.migrated_pct).toBe(100);
    expect(report.rehearsal).toBe(false);
  });

  it('fails while historical screens are unlinked', () => {
    const report = coverageVerdict({ verified: 10, historicallyScreened: 8, linked: 5 });
    expect(report.passed).toBe(false);
    expect(report.unlinked).toBe(3);
  });

  it('passes vacuously with no verified subjects', () => {
    expect(coverageVerdict({ verified: 0, historicallyScreened: 0, linked: 0 }).passed).toBe(true);
  });
});

describe('plans', () => {
  it('plans a kabila copy per addon row', () => {
    const plan = planKabilaCopies([{ id: '11111111-1111-4111-8111-111111111111', full_name: 'Amina Yusuf' }]);
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe('kabila');
    expect(plan[0].reference?.startsWith('SCR-KAB-')).toBe(true);
  });

  it('plans name links without duplicating existing ones', () => {
    const plan = planNameLinks({
      verifications: [
        { id: 'v1', name: 'Mohamed A. Farah' },
        { id: 'v2', name: 'Grace Wanjiru' },
      ],
      screenings: [
        { reference: 'SCR-1', name: 'MOHAMED A FARAH' },
        { reference: 'SCR-2', name: 'Someone Else' },
      ],
      existing: [{ verification_id: 'v1', screening_ref: 'SCR-1' }],
    });
    expect(plan).toHaveLength(0);
  });

  it('plans a new name link', () => {
    const plan = planNameLinks({
      verifications: [{ id: 'v1', name: 'Joseph Kimani' }],
      screenings: [{ reference: 'SCR-9', name: 'Joseph Kimani' }],
      existing: [],
    });
    expect(plan).toEqual([{ kind: 'name-link', id: 'v1', reference: 'SCR-9', name: 'Joseph Kimani' }]);
  });
});
