import { describe, expect, it } from 'vitest';
import { isValidPlate, normalizePlate, normalizeUgPhone } from 'src/lib/phones';

describe('normalizeUgPhone', () => {
  it('normalizes local formats to E.164', () => {
    expect(normalizeUgPhone('0772000000')).toBe('+256772000000');
    expect(normalizeUgPhone('256772000000')).toBe('+256772000000');
    expect(normalizeUgPhone('+256 772 000000')).toBe('+256772000000');
    expect(normalizeUgPhone('00256772000000')).toBe('+256772000000');
    expect(normalizeUgPhone('0701440613')).toBe('+256701440613');
    expect(normalizeUgPhone('256701440613')).toBe('+256701440613');
    expect(normalizeUgPhone('+256701440613')).toBe('+256701440613');
    expect(normalizeUgPhone('701440613')).toBe('+256701440613');
    expect(normalizeUgPhone('2560701440613')).toBe('+256701440613');
    expect(normalizeUgPhone('0701 440 613')).toBe('+256701440613');
  });

  it('rejects invalid numbers', () => {
    expect(normalizeUgPhone('123')).toBeNull();
    expect(normalizeUgPhone('+254700000000')).toBeNull();
    expect(normalizeUgPhone('')).toBeNull();
    expect(normalizeUgPhone(null)).toBeNull();
  });
});

describe('plates', () => {
  it('normalizes plates', () => {
    expect(normalizePlate('  uax  123c ')).toBe('UAX 123C');
  });

  it('validates plates', () => {
    expect(isValidPlate('UAX 123C')).toBe(true);
    expect(isValidPlate('AB')).toBe(false);
    expect(isValidPlate('UAX-123!')).toBe(false);
  });
});
