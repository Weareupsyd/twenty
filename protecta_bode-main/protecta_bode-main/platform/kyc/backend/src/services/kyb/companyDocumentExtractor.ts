/**
 * Company-document field extraction.
 *
 * The existing OCR stack is built for identity documents - it looks for a
 * person's name, date of birth and expiry. Company documents carry a
 * different set of facts entirely, so this layer reuses the OCR *provider*
 * for text recognition and does its own field extraction on the raw text.
 *
 * Extraction is deliberately conservative. A field we are not confident
 * about is left absent rather than guessed at, because a wrong value here
 * flows straight into the cross-check and either creates a false conflict
 * (wasting an analyst's time) or a false agreement (which is worse - it
 * would corroborate a value nothing actually supports).
 */

export type CompanyDocumentType =
  | 'certificate_of_incorporation'
  | 'articles_of_association'
  | 'shareholder_register'
  | 'proof_of_address'
  | 'financial_statements'
  | 'tax_certificate'
  | 'board_resolution'
  | 'operating_licence';

export const COMPANY_DOCUMENT_TYPES: CompanyDocumentType[] = [
  'certificate_of_incorporation',
  'articles_of_association',
  'shareholder_register',
  'proof_of_address',
  'financial_statements',
  'tax_certificate',
  'board_resolution',
  'operating_licence',
];

export function isCompanyDocumentType(t: string): t is CompanyDocumentType {
  return (COMPANY_DOCUMENT_TYPES as string[]).includes(t);
}

/** Fields the cross-check compares across sources. */
export interface CompanyFields {
  legal_name?: string;
  registration_number?: string;
  company_type?: string;
  incorporation_date?: string;
  registered_address?: string;
  tax_number?: string;
}

/** A person or entity read off a shareholder register / CR12. */
export interface ExtractedPerson {
  full_name: string;
  role_hint?: string;
  ownership_percentage?: number;
  shares?: number;
}

export interface CompanyExtractionResult {
  fields: CompanyFields;
  confidence: Record<string, number>;
  /** Only populated for shareholder registers and board resolutions. */
  people: ExtractedPerson[];
  fields_expected: number;
  fields_extracted: number;
  /** Average confidence across extracted fields, or null when nothing read. */
  overall_confidence: number | null;
  warnings: string[];
}

// ── Which fields each document type is expected to carry ───────────────────
// Used to report fields_extracted / fields_expected honestly, rather than
// claiming 7/7 because we only looked for one thing.
const EXPECTED_FIELDS: Record<CompanyDocumentType, (keyof CompanyFields)[]> = {
  certificate_of_incorporation: ['legal_name', 'registration_number', 'company_type', 'incorporation_date', 'registered_address'],
  articles_of_association:      ['legal_name', 'registration_number', 'company_type', 'registered_address'],
  shareholder_register:         ['legal_name', 'registration_number'],
  proof_of_address:             ['legal_name', 'registered_address'],
  financial_statements:         ['legal_name', 'registration_number'],
  tax_certificate:              ['legal_name', 'tax_number', 'registered_address'],
  board_resolution:             ['legal_name', 'registration_number'],
  operating_licence:            ['legal_name', 'registration_number', 'registered_address'],
};

// ── Helpers ────────────────────────────────────────────────────────────────

const LINE_SPLIT = /\r?\n/;

function cleanValue(raw: string): string {
  return raw
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/^[:\---\s.]+/, '')
    .replace(/[:\---\s.]+$/, '')
    .trim();
}

/**
 * Find the value following a label, either on the same line ("Company Name:
 * Acme Ltd") or on the line below, which is how most certificates are laid
 * out. Returns null rather than a guess when nothing plausible follows.
 */
function findAllLabelled(lines: string[], patterns: RegExp[], maxLookahead = 2): Array<{ value: string; line: number }> {
  const hits: Array<{ value: string; line: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of patterns) {
      const m = line.match(pattern);
      if (!m) continue;

      // Same line, after the label.
      const after = cleanValue(line.slice(m.index! + m[0].length));
      if (after.length >= 2 && !isPureLabel(after)) {
        hits.push({ value: after, line: i });
        break;
      }

      // Next non-empty lines.
      for (let j = 1; j <= maxLookahead && i + j < lines.length; j++) {
        const next = cleanValue(lines[i + j]);
        if (!next) continue;
        if (isPureLabel(next)) break;
        hits.push({ value: next, line: i + j });
        break;
      }
      break;
    }
  }
  return hits;
}

function findLabelled(lines: string[], patterns: RegExp[], maxLookahead = 2): { value: string; line: number } | null {
  return findAllLabelled(lines, patterns, maxLookahead)[0] ?? null;
}

/** A line that is only a label carries no value. */
function isPureLabel(v: string): boolean {
  if (v.length < 2) return true;
  if (/^[:\---\s.]+$/.test(v)) return true;
  return /^(company\s*(name|number)|registration\s*(no|number)|incorporat(ed|ion)\s*(on|date)?|registered\s*(office|address)|date|address|name|number|type|tax|pin|vat)\s*:?$/i.test(v);
}

// ── Date normalisation ─────────────────────────────────────────────────────
const MONTHS: Record<string, string> = {
  jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
  apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
  aug: '08', august: '08', sep: '09', sept: '09', september: '09',
  oct: '10', october: '10', nov: '11', november: '11', dec: '12', december: '12',
};

/**
 * Normalise a date to ISO. Day-first for ambiguous numeric formats, which is
 * the convention across the target markets (KE/UG/SO/ET) - misreading
 * 06/03/2018 as June would silently corrupt an incorporation date.
 */
export function normalizeExtractedDate(raw: string): string | null {
  const s = raw.trim();

  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  const dmy = s.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmy) {
    const d = Number(dmy[1]), m = Number(dmy[2]);
    if (d <= 31 && m <= 12) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    return null;
  }

  const dMonY = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?([A-Za-z]+),?\s+(\d{4})/);
  if (dMonY) {
    const m = MONTHS[dMonY[2].toLowerCase()];
    if (m) return `${dMonY[3]}-${m}-${dMonY[1].padStart(2, '0')}`;
  }

  const monDY = s.match(/([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (monDY) {
    const m = MONTHS[monDY[1].toLowerCase()];
    if (m) return `${monDY[3]}-${m}-${monDY[2].padStart(2, '0')}`;
  }

  return null;
}

// ── Company type ───────────────────────────────────────────────────────────
const COMPANY_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/private\s+company\s+limited\s+by\s+shares/i, 'Private company limited by shares'],
  [/company\s+limited\s+by\s+guarantee/i, 'Company limited by guarantee'],
  [/public\s+limited\s+company/i, 'Public limited company'],
  [/limited\s+liability\s+partnership/i, 'Limited liability partnership'],
  [/free\s+zone\s+establishment/i, 'Free zone establishment'],
  [/co-?operative\s+society/i, 'Co-operative society'],
  [/sole\s+proprietor(ship)?/i, 'Sole proprietorship'],
  [/partnership/i, 'Partnership'],
];

function detectCompanyType(text: string): string | null {
  for (const [pattern, label] of COMPANY_TYPE_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

// ── Registration / tax numbers ─────────────────────────────────────────────

/**
 * Registration numbers vary by jurisdiction, so we anchor on the label rather
 * than trying to pattern-match the number itself - matching a bare
 * alphanumeric token would happily pick up a phone number or a postcode.
 */
function extractRegistrationNumber(lines: string[]): string | null {
  const hit = findLabelled(lines, [
    /(?:company|registration|reg\.?|incorporation)\s*(?:no\.?|number)\s*:?/i,
    /\bCPR\/\d*\s*:?/i,
    /\bregistry\s*(?:no\.?|number)\s*:?/i,
  ]);
  if (!hit) return null;

  const token = hit.value.split(/\s+/)[0].replace(/[^A-Za-z0-9\-/]/g, '');
  if (token.length < 3 || token.length > 30) return null;
  if (!/\d/.test(token)) return null; // a registration number always has a digit
  return token.toUpperCase();
}

function extractTaxNumber(lines: string[]): string | null {
  const hit = findLabelled(lines, [
    /(?:tax|pin|vat|tin)\s*(?:no\.?|number|reg\.?)?\s*:?/i,
    /personal\s+identification\s+number\s*:?/i,
  ]);
  if (!hit) return null;

  const token = hit.value.split(/\s+/)[0].replace(/[^A-Za-z0-9\-]/g, '');
  if (token.length < 5 || token.length > 30) return null;
  if (!/\d/.test(token)) return null;
  return token.toUpperCase();
}

// ── Legal name ─────────────────────────────────────────────────────────────
const NAME_SUFFIX = /\b(limited|ltd\.?|plc|inc\.?|corporation|corp\.?|llp|llc|fze|sacco|holdings?|company|co\.?)\b/i;
/** A company name ends with its suffix - used to spot an unlabelled name line. */
const NAME_SUFFIX_TRAILING = /\b(limited|ltd|plc|inc|corporation|corp|llp|llc|fze|sacco|holdings?)\.?$/i;

function extractLegalName(lines: string[]): string | null {
  const labelled = findLabelled(lines, [
    /(?:the\s+)?(?:company|entity|business|corporate)\s*name\s*:?/i,
    /name\s+of\s+(?:the\s+)?(?:company|entity|business)\s*:?/i,
    /\bregistered\s+name\s*:?/i,
  ]);
  if (labelled && NAME_SUFFIX.test(labelled.value)) return labelled.value;
  if (labelled && labelled.value.length >= 3) return labelled.value;

  // Certificates often state the name on its own line, in caps, with a
  // corporate suffix - and no label at all.
  //
  // Anchor on the suffix appearing at the END of the line. Merely containing
  // the word "company" also matches "Company Number: PVT-4XKJ8R2", which is a
  // label line, not a name.
  for (const raw of lines) {
    const line = cleanValue(raw);
    if (line.length < 4 || line.length > 120) continue;
    if (line.includes(':')) continue;                       // a labelled field, not a name
    if (!NAME_SUFFIX_TRAILING.test(line)) continue;
    if (/^(this|that|the\s+registrar|certificate|i\s+hereby|given\s+under)/i.test(line)) continue;
    if (/\b(certif|incorporat|registrar|hereby|pursuant|section)\b/i.test(line)) continue;
    if (line.split(/\s+/).length < 2) continue;              // "LIMITED" alone is not a name
    return line;
  }
  return null;
}

// ── Address ────────────────────────────────────────────────────────────────
function extractAddress(lines: string[]): string | null {
  const hit = findLabelled(lines, [
    /registered\s+(?:office|address)\s*(?:address)?\s*:?/i,
    /principal\s+place\s+of\s+business\s*:?/i,
    /\bbusiness\s+address\s*:?/i,
    /\baddress\s*:?/i,
  ], 3);
  if (!hit) return null;

  // Addresses wrap. Pull following lines until something that clearly isn't
  // part of the address.
  const parts = [hit.value];
  for (let i = hit.line + 1; i < Math.min(hit.line + 4, lines.length); i++) {
    const next = cleanValue(lines[i]);
    if (!next) break;
    if (isPureLabel(next)) break;
    if (/^(date|company|registration|tax|pin|signed|dated|director)/i.test(next)) break;
    if (next.length > 80) break;
    parts.push(next);
  }
  const joined = parts.join(', ').replace(/,\s*,/g, ',').trim();
  return joined.length >= 5 ? joined : null;
}

// ── Shareholder register ───────────────────────────────────────────────────

/**
 * Parse owner rows out of a shareholder register / CR12.
 *
 * Registers are tabular, and OCR flattens tables into lines, so we look for a
 * name followed by a percentage and/or a share count. Rows we cannot parse
 * confidently are skipped and reported as a warning - an analyst chasing one
 * missing owner is far better than a silently wrong ownership graph that
 * reconciles to the wrong 100%.
 */
export function extractPeople(text: string): { people: ExtractedPerson[]; warnings: string[] } {
  const lines = text.split(LINE_SPLIT).map((l) => l.trim()).filter(Boolean);
  const people: ExtractedPerson[] = [];
  const warnings: string[] = [];

  const ROLE_HINT = /\b(director|secretary|shareholder|member|chairman|chairperson|signatory|founder|partner|trustee|ubo|beneficial\s+owner)\b/i;

  for (const line of lines) {
    if (/^(name|shareholder|member|director)s?\b.*\b(shares?|holding|percentage|%)/i.test(line)) continue; // header row

    const pct = line.match(/(\d{1,3}(?:\.\d{1,3})?)\s*%/);
    const shares = line.match(/\b(\d{1,3}(?:[,\s]\d{3})+|\d{4,})\s*(?:ordinary\s+)?shares?\b/i);
    if (!pct && !shares && !ROLE_HINT.test(line)) continue;

    // The name is the leading run of name-like words.
    const nameMatch = line.match(/^([A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*){0,5})/);
    if (!nameMatch) continue;

    let name = cleanValue(nameMatch[1]);
    name = name.replace(new RegExp(`\\s*${ROLE_HINT.source}.*$`, 'i'), '').trim();
    if (name.length < 3 || name.split(/\s+/).length < 2) {
      if (pct) warnings.push(`Could not read an owner name from: "${line.slice(0, 60)}"`);
      continue;
    }
    if (/^(total|subtotal|sum)\b/i.test(name)) continue;

    const roleHit = line.match(ROLE_HINT);
    const person: ExtractedPerson = { full_name: name };
    if (roleHit) person.role_hint = roleHit[0].toLowerCase();
    if (pct) person.ownership_percentage = Number(pct[1]);
    if (shares) person.shares = Number(shares[1].replace(/[,\s]/g, ''));

    if (!people.some((p) => p.full_name.toLowerCase() === person.full_name.toLowerCase())) {
      people.push(person);
    }
  }

  const total = people.reduce((s, p) => s + (p.ownership_percentage ?? 0), 0);
  if (people.length > 0 && total > 0 && Math.abs(total - 100) > 0.5) {
    warnings.push(`Ownership on this register totals ${Number(total.toFixed(3))}%, not 100%`);
  }

  return { people, warnings };
}

// ── Entry point ────────────────────────────────────────────────────────────

/**
 * Extract company fields from OCR'd text.
 *
 * `providerConfidence` is the OCR engine's own confidence in the text it
 * read. Per-field confidence is that, discounted for fields we inferred
 * rather than read from an explicit label - so the caller can tell the
 * difference between "the document says this" and "we think this".
 */
export function extractCompanyFields(
  rawText: string,
  documentType: string,
  providerConfidence = 0.8,
): CompanyExtractionResult {
  const text = rawText ?? '';
  const lines = text.split(LINE_SPLIT).map((l) => l.trim());
  const warnings: string[] = [];

  const fields: CompanyFields = {};
  const confidence: Record<string, number> = {};

  const legalName = extractLegalName(lines);
  if (legalName) {
    fields.legal_name = legalName;
    confidence.legal_name = providerConfidence;
  }

  const regNo = extractRegistrationNumber(lines);
  if (regNo) {
    fields.registration_number = regNo;
    confidence.registration_number = providerConfidence;
  }

  const companyType = detectCompanyType(text);
  if (companyType) {
    fields.company_type = companyType;
    // Inferred from phrasing rather than read from a labelled field.
    confidence.company_type = providerConfidence * 0.9;
  }

  // Prose like "is this day incorporated under the Companies Act" matches the
  // same label pattern as the real date line, so take the first candidate
  // that actually parses rather than the first that merely matches.
  const dateHits = findAllLabelled(lines, [
    /date\s+of\s+incorporat(?:ion|ed)\s*:?/i,
    /incorporat(?:ion|ed)\s+(?:on|date)\s*:?/i,
    /registered\s+on\s*:?/i,
    /\bissued\s+on\s*:?/i,
    /incorporat(?:ion|ed)\s*:?/i,
  ]);
  const parsed = dateHits
    .map((h) => ({ hit: h, iso: normalizeExtractedDate(h.value) }))
    .find((c) => c.iso !== null);

  if (parsed?.iso) {
    fields.incorporation_date = parsed.iso;
    confidence.incorporation_date = providerConfidence;
  } else if (dateHits.length > 0) {
    warnings.push(`Found an incorporation date but could not parse it: "${dateHits[0].value.slice(0, 40)}"`);
  }

  const address = extractAddress(lines);
  if (address) {
    fields.registered_address = address;
    confidence.registered_address = providerConfidence * 0.95;
  }

  const taxNo = extractTaxNumber(lines);
  if (taxNo) {
    fields.tax_number = taxNo;
    confidence.tax_number = providerConfidence;
  }

  // People, only where the document is expected to carry them.
  let people: ExtractedPerson[] = [];
  if (documentType === 'shareholder_register' || documentType === 'board_resolution') {
    const res = extractPeople(text);
    people = res.people;
    warnings.push(...res.warnings);
  }

  const expected = isCompanyDocumentType(documentType)
    ? EXPECTED_FIELDS[documentType]
    : (['legal_name', 'registration_number'] as (keyof CompanyFields)[]);

  const extractedCount = expected.filter((f) => fields[f] !== undefined).length;

  const scores = Object.values(confidence);
  const overall = scores.length > 0 ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3)) : null;

  if (scores.length === 0) {
    warnings.push('No company fields could be read from this document');
  }

  return {
    fields,
    confidence,
    people,
    fields_expected: expected.length,
    fields_extracted: extractedCount,
    overall_confidence: overall,
    warnings,
  };
}
