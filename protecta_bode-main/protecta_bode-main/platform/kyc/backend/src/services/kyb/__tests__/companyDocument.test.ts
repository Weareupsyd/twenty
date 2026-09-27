/**
 * Company document extraction tests.
 *
 * These use realistic OCR output - including the noise a real scan produces
 * (bilingual labels, wrapped addresses, inconsistent date formats) - because
 * the extractor's whole job is surviving that.
 */

import { describe, it, expect, vi } from 'vitest';

// companyDocumentService imports StorageService, which imports the database
// config at module load. The tamper heuristics under test are pure, so stub
// the modules that would otherwise demand a live DB connection.
vi.mock('@/config/database.js', () => ({ supabase: {}, connectDB: vi.fn() }));
vi.mock('@/services/storage.js', () => ({ StorageService: class {} }));
vi.mock('@/providers/ocr/index.js', () => ({ createOCRProvider: () => ({ name: 'stub', processDocument: vi.fn() }) }));
vi.mock('@/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logError: vi.fn(),
}));

import {
  extractCompanyFields,
  extractPeople,
  normalizeExtractedDate,
  isCompanyDocumentType,
  COMPANY_DOCUMENT_TYPES,
} from '../companyDocumentExtractor.js';
import { assessTamperSignals } from '../companyDocumentService.js';

// A plausible Kenyan certificate of incorporation as OCR would flatten it.
const CERT = `
REPUBLIC OF KENYA
THE COMPANIES ACT, 2015
CERTIFICATE OF INCORPORATION

Company Number: PVT-4XKJ8R2

I hereby certify that

ACME LOGISTICS KENYA LIMITED

is this day incorporated under the Companies Act, 2015 and that the
company is a private company limited by shares.

Registered Office: Enterprise Road, Industrial Area
Nairobi, 00100

Date of Incorporation: 6 March 2018

Given under my hand at Nairobi
Registrar of Companies
`.trim();

const ARTICLES = `
ARTICLES OF ASSOCIATION
OF
ACME LOGISTICS KENYA LTD

Registration Number: PVT-4XKJ8R2

The company is a private company limited by shares.

Registered Office: Enterprise Road, Industrial Area
Nairobi

Share Capital: KES 5,000,000 divided into 5,000 ordinary shares
`.trim();

const REGISTER = `
SHAREHOLDER REGISTER - CR12
ACME LOGISTICS KENYA LIMITED
Registration Number: PVT-4XKJ8R2

Name                        Shares      Holding
Amina Warsame               2600 shares   52%
Joseph Kimani               1400 shares   28%
Sahan Holdings Ltd          1000 shares   20%

Fatuma Hassan   Director
Peter Otieno    Chairman
`.trim();

// ── Dates ──────────────────────────────────────────────────────────────────
describe('date normalisation', () => {
  it('reads the formats certificates actually use', () => {
    expect(normalizeExtractedDate('2018-03-06')).toBe('2018-03-06');
    expect(normalizeExtractedDate('06/03/2018')).toBe('2018-03-06');
    expect(normalizeExtractedDate('6 March 2018')).toBe('2018-03-06');
    expect(normalizeExtractedDate('6th day of March, 2018')).toBe('2018-03-06');
    expect(normalizeExtractedDate('March 6, 2018')).toBe('2018-03-06');
  });

  it('is day-first for ambiguous numeric dates', () => {
    // 06/03 must be 6 March, not 3 June - misreading this silently corrupts
    // an incorporation date that then "matches" nothing.
    expect(normalizeExtractedDate('06/03/2018')).toBe('2018-03-06');
  });

  it('returns null rather than guessing at nonsense', () => {
    expect(normalizeExtractedDate('sometime in 2018')).toBeNull();
    expect(normalizeExtractedDate('45/45/2018')).toBeNull();
  });
});

// ── Certificate ────────────────────────────────────────────────────────────
describe('certificate of incorporation', () => {
  const r = extractCompanyFields(CERT, 'certificate_of_incorporation', 0.95);

  it('reads the legal name even though it sits on an unlabelled line', () => {
    expect(r.fields.legal_name).toBe('ACME LOGISTICS KENYA LIMITED');
  });

  it('reads the registration number', () => {
    expect(r.fields.registration_number).toBe('PVT-4XKJ8R2');
  });

  it('infers the company type from the prose', () => {
    expect(r.fields.company_type).toBe('Private company limited by shares');
  });

  it('normalises the incorporation date to ISO', () => {
    expect(r.fields.incorporation_date).toBe('2018-03-06');
  });

  it('reads the wrapped registered address', () => {
    expect(r.fields.registered_address).toContain('Enterprise Road');
    expect(r.fields.registered_address).toContain('Nairobi');
  });

  it('reports what it found against what was expected', () => {
    expect(r.fields_expected).toBe(5);
    expect(r.fields_extracted).toBe(5);
    expect(r.overall_confidence).toBeGreaterThan(0.8);
  });

  it('scores an inferred field below an explicitly labelled one', () => {
    // company_type is inferred from phrasing; registration_number is read
    // from a label. The confidence should say so.
    expect(r.confidence.company_type).toBeLessThan(r.confidence.registration_number);
  });
});

// ── Cross-document agreement ───────────────────────────────────────────────
describe('two documents describing one company', () => {
  it('extracts the same registration number from both', () => {
    const a = extractCompanyFields(CERT, 'certificate_of_incorporation');
    const b = extractCompanyFields(ARTICLES, 'articles_of_association');
    expect(a.fields.registration_number).toBe(b.fields.registration_number);
  });

  it('extracts names that differ only by Ltd/Limited', () => {
    const a = extractCompanyFields(CERT, 'certificate_of_incorporation');
    const b = extractCompanyFields(ARTICLES, 'articles_of_association');
    expect(a.fields.legal_name).not.toBe(b.fields.legal_name);
    // The cross-check normalises these to a MATCH - proven in kyb.test.ts.
    expect(a.fields.legal_name?.toLowerCase()).toContain('acme logistics kenya');
    expect(b.fields.legal_name?.toLowerCase()).toContain('acme logistics kenya');
  });
});

// ── Shareholder register ───────────────────────────────────────────────────
describe('shareholder register', () => {
  const { people, warnings } = extractPeople(REGISTER);

  it('reads every owner with their percentage', () => {
    const amina = people.find((p) => p.full_name === 'Amina Warsame');
    expect(amina?.ownership_percentage).toBe(52);
    expect(amina?.shares).toBe(2600);

    const joseph = people.find((p) => p.full_name === 'Joseph Kimani');
    expect(joseph?.ownership_percentage).toBe(28);
  });

  it('reads the corporate shareholder', () => {
    expect(people.find((p) => p.full_name === 'Sahan Holdings Ltd')?.ownership_percentage).toBe(20);
  });

  it('picks up officers listed with a role but no shareholding', () => {
    expect(people.find((p) => p.full_name === 'Fatuma Hassan')?.role_hint).toBe('director');
    expect(people.find((p) => p.full_name === 'Peter Otieno')?.role_hint).toBe('chairman');
  });

  it('does not warn when ownership reconciles', () => {
    expect(warnings.filter((w) => w.includes('totals'))).toHaveLength(0);
  });

  it('warns when the register does not reach 100%', () => {
    const short = extractPeople('Amina Warsame  2600 shares  52%\nJoseph Kimani  1400 shares  28%');
    expect(short.warnings.some((w) => w.includes('80'))).toBe(true);
  });

  it('skips the header row rather than inventing an owner called "Name"', () => {
    expect(people.some((p) => /^name$/i.test(p.full_name))).toBe(false);
  });

  it('ignores a totals row', () => {
    const withTotal = extractPeople('Amina Warsame 52%\nTotal Shares 100%');
    expect(withTotal.people.some((p) => /^total/i.test(p.full_name))).toBe(false);
  });

  it('only looks for people on documents that carry them', () => {
    expect(extractCompanyFields(CERT, 'certificate_of_incorporation').people).toHaveLength(0);
    expect(extractCompanyFields(REGISTER, 'shareholder_register').people.length).toBeGreaterThan(0);
  });
});

// ── Conservatism ───────────────────────────────────────────────────────────
describe('extraction is conservative', () => {
  it('returns nothing from an unrelated document rather than guessing', () => {
    const r = extractCompanyFields('Dear Sir, thank you for your enquiry. Kind regards.', 'certificate_of_incorporation');
    expect(r.fields.legal_name).toBeUndefined();
    expect(r.fields.registration_number).toBeUndefined();
    expect(r.warnings.some((w) => /no company fields/i.test(w))).toBe(true);
  });

  it('rejects a registration "number" with no digits', () => {
    const r = extractCompanyFields('Company Number: ABCDEFG', 'certificate_of_incorporation');
    expect(r.fields.registration_number).toBeUndefined();
  });

  it('does not mistake a label line for a value', () => {
    const r = extractCompanyFields('Company Name:\n\nRegistration Number: X-123', 'certificate_of_incorporation');
    expect(r.fields.legal_name).not.toBe('Registration Number');
  });

  it('warns when a date is present but unparseable', () => {
    const r = extractCompanyFields('Date of Incorporation: sometime last spring', 'certificate_of_incorporation');
    expect(r.fields.incorporation_date).toBeUndefined();
    expect(r.warnings.some((w) => /could not parse/i.test(w))).toBe(true);
  });

  it('knows its own document types', () => {
    expect(isCompanyDocumentType('certificate_of_incorporation')).toBe(true);
    expect(isCompanyDocumentType('passport')).toBe(false);
    expect(COMPANY_DOCUMENT_TYPES).toHaveLength(8);
  });
});

// ── Tamper heuristics ──────────────────────────────────────────────────────
describe('tamper signals', () => {
  const good = extractCompanyFields(CERT, 'certificate_of_incorporation', 0.95);

  it('passes a document that reads like a company record', () => {
    expect(assessTamperSignals(CERT, good).passed).toBe(true);
  });

  it('returns null - not false - when there is no text layer at all', () => {
    // Unreadable is "we cannot tell", which is a different answer from
    // "this failed a check". An analyst must see the difference.
    const r = assessTamperSignals('', { ...good, fields_extracted: 0, overall_confidence: null });
    expect(r.passed).toBeNull();
    expect(r.notes).toMatch(/manual inspection/i);
  });

  it('flags a document that mentions no company at all', () => {
    const r = assessTamperSignals(
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam quis nostrud.',
      { ...good, fields_extracted: 0 },
    );
    expect(r.passed).toBe(false);
    expect(r.notes).toMatch(/does not read like a company record/i);
  });

  it('flags low OCR confidence', () => {
    const r = assessTamperSignals(CERT, { ...good, overall_confidence: 0.4 });
    expect(r.passed).toBe(false);
    expect(r.notes).toMatch(/low ocr confidence/i);
  });

  it('flags a near-empty scan', () => {
    const r = assessTamperSignals('Company Ltd', { ...good, fields_extracted: 1 });
    expect(r.passed).toBe(false);
    expect(r.notes).toMatch(/very little text/i);
  });
});
