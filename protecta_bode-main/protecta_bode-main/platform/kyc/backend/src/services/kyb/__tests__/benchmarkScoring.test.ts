/**
 * Tests for the OCR benchmark's scoring logic.
 *
 * The benchmark's whole value is that its number can be trusted. A scorer that
 * is too lenient hides a regression; one that is too strict cries wolf on
 * casing and makes the team stop reading the report. Both failure modes are
 * covered here.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeValue,
  normalizeDate,
  similarity,
  compareFields,
  parseArgs,
  percentile,
} from '../../../../scripts/benchmark/benchmark-ocr.js';

describe('value normalisation', () => {
  it('treats casing and punctuation differences as the same read', () => {
    expect(normalizeValue("O'BRIEN")).toBe(normalizeValue('O Brien'));
    expect(normalizeValue('KAMPALA')).toBe(normalizeValue('Kampala'));
    expect(normalizeValue('SARAH  MIRIAM')).toBe(normalizeValue('Sarah Miriam'));
  });

  it('still distinguishes genuinely different text', () => {
    expect(normalizeValue('NAKATO')).not.toBe(normalizeValue('NAKATU'));
  });

  it('keeps digits and letters, so a document number stays comparable', () => {
    expect(normalizeValue('CF85012345PEXD')).toBe('CF85012345PEXD');
  });

  it('handles null and undefined without throwing', () => {
    expect(normalizeValue(null)).toBe('');
    expect(normalizeValue(undefined)).toBe('');
  });
});

describe('date normalisation', () => {
  it('accepts ISO', () => {
    expect(normalizeDate('1985-01-06')).toBe('1985-01-06');
  });

  it('reads ambiguous numeric dates day-first, matching the extractor', () => {
    expect(normalizeDate('06/03/1985')).toBe('1985-03-06');
    expect(normalizeDate('6.3.1985')).toBe('1985-03-06');
  });

  it('pads single digits', () => {
    expect(normalizeDate('2018-3-6')).toBe('2018-03-06');
  });

  it('returns null for nonsense rather than a wrong date', () => {
    expect(normalizeDate('not a date')).toBeNull();
  });
});

describe('similarity', () => {
  it('is 1 for identical strings and 0 against an empty one', () => {
    expect(similarity('ABC', 'ABC')).toBe(1);
    expect(similarity('ABC', '')).toBe(0);
  });

  it('scores a one-character misread high but not perfect', () => {
    const s = similarity('CF85012345PEXD', 'CF8501234SPEXD');
    expect(s).toBeGreaterThan(0.9);
    expect(s).toBeLessThan(1);
  });

  it('scores an entirely wrong value low', () => {
    expect(similarity('NAKATO', 'ZXQWVB')).toBeLessThan(0.3);
  });
});

describe('field comparison', () => {
  const expected = {
    surname: 'NAKATO',
    nin: 'CF85012345PEXD',
    date_of_birth: '1985-01-06',
  };

  it('passes a perfect read', () => {
    const results = compareFields(expected, {
      surname: 'Nakato', nin: 'CF85012345PEXD', date_of_birth: '06/01/1985',
    } as never);
    expect(results.every((r) => r.exact)).toBe(true);
  });

  it('flags a single wrong character as not exact - this would fail a real verification', () => {
    const results = compareFields(expected, {
      surname: 'NAKATO', nin: 'CF8501234SPEXD', date_of_birth: '1985-01-06',
    } as never);
    const nin = results.find((r) => r.field === 'nin')!;
    expect(nin.exact).toBe(false);
    expect(nin.similarity).toBeGreaterThan(0.9); // close, but still wrong
  });

  it('distinguishes a missing field from a wrong one', () => {
    const results = compareFields(expected, {
      surname: 'NAKATO', nin: '', date_of_birth: '1985-01-06',
    } as never);
    const nin = results.find((r) => r.field === 'nin')!;
    expect(nin.missing).toBe(true);
    expect(nin.exact).toBe(false);
  });

  it('does not score a field the ground truth never claimed', () => {
    const results = compareFields({ surname: 'NAKATO' }, {
      surname: 'NAKATO', nationality: 'UGANDAN',
    } as never);
    expect(results).toHaveLength(1);
  });

  it('never marks a swapped day/month as correct', () => {
    const results = compareFields({ date_of_birth: '1985-01-06' }, { date_of_birth: '1985-06-01' } as never);
    expect(results[0].exact).toBe(false);
  });
});

describe('CLI parsing', () => {
  it('defaults to the paths the npm script uses', () => {
    const args = parseArgs([]);
    expect(args.specimensDir).toBe('scripts/benchmark/specimens');
    expect(args.output).toBe('scripts/benchmark/benchmark-results.json');
    expect(args.providers).toEqual(['paddle', 'tesseract']);
  });

  it('accepts the flags npm run benchmark passes', () => {
    const args = parseArgs(['--specimens-dir', 'a/b', '--output', 'c/d.json']);
    expect(args.specimensDir).toBe('a/b');
    expect(args.output).toBe('c/d.json');
  });

  it('accepts --flag=value form too', () => {
    expect(parseArgs(['--providers=paddle']).providers).toEqual(['paddle']);
  });

  it('reads the CI gate threshold as a number', () => {
    expect(parseArgs(['--fail-under', '90']).failUnder).toBe(90);
  });
});

describe('percentile', () => {
  it('reports the median and p95 of a sorted series', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
  });

  it('returns 0 for an empty series instead of NaN', () => {
    expect(percentile([], 50)).toBe(0);
  });
});
