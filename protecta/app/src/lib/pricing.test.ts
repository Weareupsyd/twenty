import { describe, expect, it } from 'vitest';
import {
  computePremium,
  DEFAULT_PRICING,
  isQuoteExpired,
  policyPeriod,
  quoteValidUntil,
  validateVehicleValue,
} from 'src/lib/pricing';

describe('computePremium', () => {
  it('charges 1.5% rounded to whole shillings', () => {
    expect(computePremium(5_000_000, 0.015)).toBe(75_000);
    expect(computePremium(1_000_000, 0.015)).toBe(15_000);
    expect(computePremium(300_000_000, 0.015)).toBe(4_500_000);
    expect(computePremium(1_000_001, 0.015)).toBe(15_000);
  });
});

describe('validateVehicleValue', () => {
  it('accepts values inside the band', () => {
    expect(validateVehicleValue(1_000_000, DEFAULT_PRICING)).toBeNull();
    expect(validateVehicleValue(300_000_000, DEFAULT_PRICING)).toBeNull();
  });

  it('rejects values outside the band', () => {
    expect(validateVehicleValue(999_999, DEFAULT_PRICING)).toContain('at least');
    expect(validateVehicleValue(300_000_001, DEFAULT_PRICING)).toContain('at most');
    expect(validateVehicleValue(Number.NaN, DEFAULT_PRICING)).toContain('number');
  });
});

describe('periods', () => {
  it('quotes last 15 days by default', () => {
    expect(quoteValidUntil(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-16');
  });

  it('policies last 365 days by default', () => {
    expect(policyPeriod(new Date('2026-01-01T00:00:00Z'))).toEqual({
      start: '2026-01-01',
      end: '2027-01-01',
    });
  });

  it('detects expired quotes', () => {
    expect(isQuoteExpired('2026-01-01', new Date('2026-02-01T00:00:00Z'))).toBe(true);
    expect(isQuoteExpired('2026-03-01', new Date('2026-02-01T00:00:00Z'))).toBe(false);
    expect(isQuoteExpired(null)).toBe(false);
  });
});
