import { describe, expect, it } from 'vitest';
import {
  cleanOcrValue,
  extractPersonName,
  isLabelArtifact,
  looksLikeOcrDump,
  sanitizeOcrIdentity,
  titleCaseName,
} from './ocrFields';

const UGANDA_DUMP =
  'GIVEN NAME NATIONALITY NIN DATE OF EXPIRY UGA TUTU MOSES MUGULI CM8808210G1JDF 17.08.2032 NATIONAL ID CARD SEX M DATE OF BIRTR CARD NO 021333783 30.09.1988 NATIONALITY NIN DATE OF EXPIRY UGA TUTU MOSES MUGULI CM8808210G1JDF 17.08.2032 NATIONAL ID CARD SEX M DATE OF BIRTR CARD NO 021333783 30.09.1988';

describe('ocr field sanitization', () => {
  it('rejects label-only artifacts', () => {
    expect(isLabelArtifact('SEX')).toBe(true);
    expect(isLabelArtifact('DATE OF BIRTH')).toBe(true);
    expect(isLabelArtifact('NATIONALITY SEX DATE OF BIRTH')).toBe(true);
    expect(isLabelArtifact('TUTU MOSES')).toBe(false);
  });

  it('treats the Uganda ID dump as a mixed OCR dump', () => {
    expect(looksLikeOcrDump(UGANDA_DUMP)).toBe(true);
  });

  it('extracts a short person name from a jumbled ID dump', () => {
    expect(extractPersonName(UGANDA_DUMP)).toBe('Tutu Moses Muguli');
    expect(extractPersonName(UGANDA_DUMP)?.split(' ')).toHaveLength(3);
  });

  it('title-cases an already-clean uppercase name', () => {
    expect(titleCaseName('TUTU MOSES MUGULI')).toBe('Tutu Moses Muguli');
    expect(extractPersonName('TUTU MOSES MUGULI')).toBe('Tutu Moses Muguli');
  });

  it('does not return the raw dump from cleanOcrValue', () => {
    expect(cleanOcrValue(UGANDA_DUMP)).toBe('Tutu Moses Muguli');
    expect(cleanOcrValue('SEX DATE OF BIRTH')).toBeNull();
    expect(cleanOcrValue('Jane Doe')).toBe('Jane Doe');
  });

  it('splits a dump into dedicated identity fields', () => {
    const identity = sanitizeOcrIdentity({ full_name: UGANDA_DUMP });
    expect(identity.name).toBe('Tutu Moses Muguli');
    expect(identity.nationality).toBe('UGA');
    expect(identity.idNumber).toBe('CM8808210G1JDF');
    expect(identity.sex).toBe('M');
    expect(identity.dateOfBirth).toBe('1988-09-30');
    expect(identity.expiry).toBe('2032-08-17');
  });

  it('prefers dedicated fields over dump parsing', () => {
    const identity = sanitizeOcrIdentity({
      full_name: 'Amina Yusuf',
      date_of_birth: '1994-02-18',
      nationality: 'KE',
      document_number: 'A0294471',
    });
    expect(identity).toEqual({
      name: 'Amina Yusuf',
      dateOfBirth: '1994-02-18',
      nationality: 'KE',
      idNumber: 'A0294471',
      sex: null,
      expiry: null,
    });
  });
});
