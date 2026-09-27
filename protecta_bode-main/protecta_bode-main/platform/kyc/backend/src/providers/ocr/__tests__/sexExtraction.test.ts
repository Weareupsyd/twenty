/**
 * Sex/gender field extraction tests.
 *
 * Regression coverage for the "Sex field always empty" bug on Ugandan
 * national IDs: the NIRA card prints "NATIONALITY  SEX  DATE OF BIRTH" as a
 * header row with the values ("UGA  F  04.06.1990") on the following line.
 * The old same-line-only regex could never match that layout, and
 * NationalIdExtractor / GenericExtractor had no sex extraction at all.
 */
import { describe, it, expect } from 'vitest';
import { getCountryFormat } from '@kabila/shared';
import { InternationalExtractor } from '../extractors/InternationalExtractor.js';
import { NationalIdExtractor } from '../extractors/NationalIdExtractor.js';
import { GenericExtractor } from '../extractors/GenericExtractor.js';
import type { OCRData } from '../../../types/index.js';

// Build RecognitionResult[][] - one inner array per visual line.
const asLines = (texts: string[], confidence = 0.9) =>
  texts.map(t => [{ text: t, confidence, box: { x: 0, y: 0, width: 100, height: 10 } }]) as any;

const freshOcrData = (): OCRData => ({ confidence_scores: {} } as OCRData);

const UG_FORMAT = getCountryFormat('UG', 'national_id')!;

describe('InternationalExtractor - sex on Ugandan national ID', () => {
  it('extracts sex from the stacked header-row -> value-row layout (NIRA card)', () => {
    const ocrData = freshOcrData();
    new InternationalExtractor().extract(
      asLines([
        'REPUBLIC OF UGANDA',
        'NATIONAL ID CARD',
        'SURNAME',
        'NAKATO',
        'GIVEN NAME',
        'SARAH',
        'NATIONALITY SEX DATE OF BIRTH',
        'UGA F 04.06.1990',
        'NIN CM90012345678A',
        'CARD NO 012345678',
      ]),
      ocrData,
      UG_FORMAT,
      'UG',
    );
    expect(ocrData.sex).toBe('F');
    expect(ocrData.confidence_scores!.sex).toBeGreaterThan(0);
  });

  it('extracts sex when the label and value are on separate lines', () => {
    const ocrData = freshOcrData();
    new InternationalExtractor().extract(
      asLines(['SEX', 'M']),
      ocrData,
      UG_FORMAT,
      'UG',
    );
    expect(ocrData.sex).toBe('M');
  });

  it('still extracts same-line values (SEX: F)', () => {
    const ocrData = freshOcrData();
    new InternationalExtractor().extract(
      asLines(['SEX: F']),
      ocrData,
      UG_FORMAT,
      'UG',
    );
    expect(ocrData.sex).toBe('F');
  });

  it('extracts full-word values (SEX: FEMALE)', () => {
    const ocrData = freshOcrData();
    new InternationalExtractor().extract(
      asLines(['SEX: FEMALE']),
      ocrData,
      UG_FORMAT,
      'UG',
    );
    expect(ocrData.sex).toBe('F');
  });

  it('does not fabricate sex when no sex label exists', () => {
    const ocrData = freshOcrData();
    new InternationalExtractor().extract(
      asLines(['SURNAME', 'MUKASA', 'GIVEN NAME', 'FRED']),
      ocrData,
      UG_FORMAT,
      'UG',
    );
    expect(ocrData.sex).toBeUndefined();
  });

  it('does not match letters embedded in words near the label', () => {
    const ocrData = freshOcrData();
    new InternationalExtractor().extract(
      // "FACIAL" and "MINISTRY" contain F/M but never as standalone tokens
      asLines(['SEX', 'FACIAL', 'MINISTRY']),
      ocrData,
      UG_FORMAT,
      'UG',
    );
    expect(ocrData.sex).toBeUndefined();
  });
});

describe('NationalIdExtractor - sex extraction', () => {
  it('extracts same-line sex values', () => {
    const ocrData = freshOcrData();
    new NationalIdExtractor().extract(asLines(['NATIONAL ID', 'SEX: M']), ocrData);
    expect(ocrData.sex).toBe('M');
  });

  it('extracts label-above-value sex layout', () => {
    const ocrData = freshOcrData();
    new NationalIdExtractor().extract(asLines(['NATIONAL ID', 'SEX', 'F']), ocrData);
    expect(ocrData.sex).toBe('F');
  });
});

describe('GenericExtractor - sex extraction', () => {
  it('extracts sex from generic documents', () => {
    const ocrData = freshOcrData();
    new GenericExtractor().extract(asLines(['GENDER: F']), ocrData);
    expect(ocrData.sex).toBe('F');
  });
});
