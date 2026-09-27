/**
 * Labeled-field parsing regression tests for the Ugandan national-ID address
 * block.
 *
 * The NIRA card prints "VELAGE UPPER NSOOBA / PARISH MULAGO /
 * A.COUNTY KAWEMPE DIVISION / DISTRICT KAMPALA" - i.e. OCR-garbled labels and a
 * bare space (not a colon) separator. `extractLabeledFields` must recover the
 * village / parish / sub-county / district from that layout, and still handle
 * the canonical "LABEL: VALUE" form used elsewhere.
 */
import { describe, it, expect } from 'vitest';
import { extractLabeledFields, mergeLabeledAddressFields } from '@kabila/shared';

describe('extractLabeledFields - Ugandan ID address block', () => {
  it('parses the garbled, space-separated back-of-card block', () => {
    const raw = [
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

    expect(extractLabeledFields(raw)).toEqual({
      village: 'UPPER NS0OBA',
      parish: 'MULAGO',
      sub_county: 'KAWENPE DIVISION',
      district: 'KAMPALA',
    });
  });

  it('still parses the canonical LABEL: VALUE format', () => {
    const raw = [
      'VILLAGE: UPPER NSOOBA',
      'PARISH: MULAGO III',
      'S.COUNTY: KAWEMPE DIVISION',
      'DISTRICT: KAMPALA',
    ].join('\n');

    expect(extractLabeledFields(raw)).toEqual({
      village: 'UPPER NSOOBA',
      parish: 'MULAGO III',
      sub_county: 'KAWEMPE DIVISION',
      district: 'KAMPALA',
    });
  });

  it('ignores the front-of-card block (no address label match)', () => {
    const raw = [
      'REPUBLIC OF UGANDA',
      'NATIONAL ID CARD',
      'SURNAME',
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

    expect(extractLabeledFields(raw)).toEqual({});
  });

  it('does not fabricate fields from unrelated lines', () => {
    const raw = [
      'NATIONAL ID CARD',
      'RIGHT THUMB',
      'NIN CARD NO.',
      'HOLDERS SIGNATURE',
    ].join('\n');

    expect(extractLabeledFields(raw)).toEqual({});
  });
});

describe('mergeLabeledAddressFields - Ugandan ID', () => {
  it('fills blank address fields without clobbering existing values', () => {
    const payload: Record<string, unknown> = {
      first_name: 'MOSES',
      last_name: 'MUGULI',
      district: 'KAMPALA', // already populated - must not be overwritten
    };
    const raw = 'VELAGE UPPER NSOOBA\nPARISH MULAGO\nA.COUNTY KAWEMPE DIVISION\nDISTRICT KAMPALA';

    const merged = mergeLabeledAddressFields(payload, raw);
    expect(merged.village).toBe('UPPER NSOOBA');
    expect(merged.parish).toBe('MULAGO');
    expect(merged.sub_county).toBe('KAWEMPE DIVISION');
    expect(merged.district).toBe('KAMPALA');
    expect(merged.first_name).toBe('MOSES');
  });
});
