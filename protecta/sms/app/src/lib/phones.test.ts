import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { msisdnForEgoSms, isValidMsisdn } from 'src/lib/phones';
import { renderTemplate } from 'src/lib/render';

describe('msisdnForEgoSms', () => {
  it('normalises local and international forms to 256... MSISDN', () => {
    expect(msisdnForEgoSms('+256779644690')).toBe('256779644690');
    expect(msisdnForEgoSms('256779644690')).toBe('256779644690');
    expect(msisdnForEgoSms('0779644690')).toBe('256779644690');
    expect(msisdnForEgoSms('779644690')).toBe('256779644690');
    expect(msisdnForEgoSms('0779 644 690')).toBe('256779644690');
  });

  it('keeps other countries as digits', () => {
    expect(msisdnForEgoSms('+254 712 345 678')).toBe('254712345678');
  });

  it('flags short numbers as invalid', () => {
    expect(isValidMsisdn(msisdnForEgoSms('077'))).toBe(false);
    expect(isValidMsisdn(msisdnForEgoSms('0779644690'))).toBe(true);
  });
});

describe('renderTemplate', () => {
  it('fills known placeholders and leaves unknown ones visible', () => {
    expect(
      renderTemplate('Quote {{reference}} costs {{premium}} ({{missing}})', {
        reference: '123',
        premium: '150,000',
      }),
    ).toBe('Quote 123 costs 150,000 ({{missing}})');
  });

  it('replaces unknown-ish keys with empty strings only when present', () => {
    expect(renderTemplate('Hi {{name}}', { name: '' })).toBe('Hi ');
    expect(renderTemplate('{{ a }}{{b}}', { a: 'X', b: 'Y' })).toBe('XY');
  });
});
