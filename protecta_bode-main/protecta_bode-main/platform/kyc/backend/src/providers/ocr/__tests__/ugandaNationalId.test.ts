/**
 * End-to-end Uganda national-ID extraction regression tests.
 *
 * Reproduces the real NIRA-card OCR output that PaddleOCR produces: garbled
 * labels and a space (not colon) separator. Covers both sides of the card:
 *   - front: "NATKINALITY GEX UATE OF TH" over "UGA M 30.09.1988"
 *   - back:  "VELAGE UPPER NS0OBA / PARISH MULAGO / A.COUNTY KAWENPE DIVISION /
 *            COUNTY KAWEMPE DIVISION / DISTRICT KAMPALA" + the MRZ block
 */
import { describe, it, expect } from 'vitest';
import { getCountryFormat } from '@kabila/shared';
import { InternationalExtractor } from '../extractors/InternationalExtractor.js';
import type { OCRData } from '../../../types/index.js';

// Build RecognitionResult[][] - one inner array per visual line.
const asLines = (texts: string[], confidence = 0.9) =>
  texts.map(t => [{ text: t, confidence, box: { x: 0, y: 0, width: 100, height: 10 } }]) as any;

const freshOcrData = (raw_text?: string): OCRData =>
  ({ confidence_scores: {}, raw_text } as unknown as OCRData);

const UG_FORMAT = getCountryFormat('UG', 'national_id')!;

describe('InternationalExtractor - Ugandan national ID', () => {
  it('recovers nationality, sex and DOB from the garbled front value row', () => {
    const rawText = [
      'REPUBLIC OF UGANDA',
      'NATIONAL ID CARD',
      'SURMAME',
      'TUTU',
      'GIVEN NAME',
      'MOSES MUGULI',
      'NATKINALITY GEX UATE OF TH',
      'UGA M 30.09.1988',
      'NIN CARD NO.',
      'CM8808210G1JDF 021333783',
      'DATE OF EXPIRY',
      '17.08.2032',
    ].join('\n');

    const ocrData = freshOcrData(rawText);
    new InternationalExtractor().extract(
      asLines(rawText.split('\n')),
      ocrData,
      UG_FORMAT,
      'UG',
    );

    expect(ocrData.date_of_birth).toBe('1988-09-30');
    expect(ocrData.sex).toBe('M');
    expect(ocrData.nationality).toBe('UGA');

    // NIN must be the bounded CM/CF token, not the merged blob or the raw MRZ
    // document number ("IDUGA0213337836CM8808210G1JDF").
    expect((ocrData as any).nin).toBe('CM8808210G1JDF');
    expect(ocrData.document_number).toBe('CM8808210G1JDF');

    // The garbled "SURMAME" label must still yield the surname (TUTU) and it
    // must be composed into the on-card full name alongside the given name.
    expect((ocrData as any).surname).toBe('TUTU');
    expect(ocrData.name).toBe('TUTU MOSES MUGULI');
    expect((ocrData as any).full_name).toBe('TUTU MOSES MUGULI');
  });

  it('recovers village / parish / sub-county / district from the garbled back block', () => {
    const rawText = [
      'RIGHT THUMB',
      'VELAGE UPPER NS0OBA',
      'PARISH MULAGO',
      'A.COUNTY KAWENPE DIVISION',
      'COUNTY KAWEMPE DIVISION',
      'DISTRICT KAMPALA',
      'IDUGA0213337836CM8808210G1JDF<',
      '8809302M3208173UGA220817<<<<<5',
      'TUTU<<MOSES<MUGULI<<<<<<<<<<<<',
    ].join('\n');

    const ocrData = freshOcrData(rawText);
    new InternationalExtractor().extract(
      asLines(rawText.split('\n')),
      ocrData,
      UG_FORMAT,
      'UG',
    );

    expect((ocrData as any).village).toBe('UPPER NS0OBA');
    expect((ocrData as any).parish).toBe('MULAGO');
    expect((ocrData as any).sub_county).toBe('KAWENPE DIVISION');
    expect((ocrData as any).district).toBe('KAMPALA');
  });
});
