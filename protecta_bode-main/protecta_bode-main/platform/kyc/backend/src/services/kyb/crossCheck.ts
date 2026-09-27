/**
 * Document-first cross-check.
 *
 * This release performs no external registry lookup. Company fields are
 * extracted from the uploaded documents and corroborated two ways:
 *
 *   1. document against document  (certificate vs articles vs register)
 *   2. document against the values the administrator typed
 *
 * A field agreed by two or more independent sources is a MATCH. A field with
 * exactly one source is UNCORROBORATED - deliberately *not* a pass, because
 * accepting a single unverified source is how bad data gets onboarded. A
 * field whose sources disagree is INCONSISTENT and goes to an analyst.
 *
 * When the registry connector is enabled it becomes one more source in the
 * same comparison; DEFERRED is what we record for it until then.
 */

export type CrossCheckResult = 'MATCH' | 'INCONSISTENT' | 'UNCORROBORATED' | 'DEFERRED';

/** Where a value came from. Administrator input is deliberately weaker. */
export type SourceKind = 'document' | 'user_provided' | 'registry';

export interface FieldValue {
  source: string;        // e.g. 'certificate_of_incorporation'
  kind: SourceKind;
  value: string | null | undefined;
}

export interface FieldCheck {
  field: string;
  result: CrossCheckResult;
  detail: string;
  values_by_source: Record<string, string | null>;
  sources_compared: number;
}

// ── Normalisation ──────────────────────────────────────────────────────────
// Comparison has to survive the ways the same fact is written down.

const COMPANY_SUFFIXES: Array<[RegExp, string]> = [
  [/\blimited\b/gi, 'ltd'],
  [/\bltd\.?\b/gi, 'ltd'],
  [/\bpublic limited company\b/gi, 'plc'],
  [/\bplc\.?\b/gi, 'plc'],
  [/\bincorporated\b/gi, 'inc'],
  [/\binc\.?\b/gi, 'inc'],
  [/\bcorporation\b/gi, 'corp'],
  [/\bcorp\.?\b/gi, 'corp'],
  [/\bcompany\b/gi, 'co'],
  [/\bco\.?\b/gi, 'co'],
  [/\bprivate\b/gi, 'pvt'],
  [/\bpvt\.?\b/gi, 'pvt'],
];

export function normalizeCompanyName(raw: string): string {
  let s = raw.toLowerCase().trim();
  for (const [pattern, replacement] of COMPANY_SUFFIXES) s = s.replace(pattern, replacement);
  return s
    .replace(/[.,]/g, ' ')
    .replace(/[^a-z0-9&\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Registration numbers differ only by punctuation and case in practice. */
export function normalizeRegistrationNumber(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const STREET_WORDS: Array<[RegExp, string]> = [
  [/\broad\b/gi, 'rd'],
  [/\bstreet\b/gi, 'st'],
  [/\bavenue\b/gi, 'ave'],
  [/\bdrive\b/gi, 'dr'],
  [/\bhighway\b/gi, 'hwy'],
  [/\bpost office box\b/gi, 'po box'],
  [/\bp\.o\.? box\b/gi, 'po box'],
  [/\bfloor\b/gi, 'fl'],
  [/\bsuite\b/gi, 'ste'],
];

export function normalizeAddress(raw: string): string {
  let s = raw.toLowerCase().trim();
  for (const [pattern, replacement] of STREET_WORDS) s = s.replace(pattern, replacement);
  return s
    .replace(/[.,]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Dates arrive as ISO, DD/MM/YYYY, "6 March 2018", etc. */
const MONTHS: Record<string, string> = {
  jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
  apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
  aug: '08', august: '08', sep: '09', sept: '09', september: '09',
  oct: '10', october: '10', nov: '11', november: '11', dec: '12', december: '12',
};

export function normalizeDate(raw: string): string {
  const s = raw.trim();

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  // DD/MM/YYYY - day-first, which is the convention in the target markets.
  const slash = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (slash) return `${slash[3]}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}`;

  const long = s.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
  if (long) {
    const m = MONTHS[long[2].toLowerCase()];
    if (m) return `${long[3]}-${m}-${long[1].padStart(2, '0')}`;
  }

  const longFirst = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (longFirst) {
    const m = MONTHS[longFirst[1].toLowerCase()];
    if (m) return `${longFirst[3]}-${m}-${longFirst[2].padStart(2, '0')}`;
  }

  return s.toLowerCase();
}

const NORMALIZERS: Record<string, (s: string) => string> = {
  legal_name: normalizeCompanyName,
  registration_number: normalizeRegistrationNumber,
  registered_address: normalizeAddress,
  incorporation_date: normalizeDate,
  tax_number: normalizeRegistrationNumber,
};

export function normalizeField(field: string, value: string): string {
  const fn = NORMALIZERS[field];
  return fn ? fn(value) : value.toLowerCase().trim().replace(/\s+/g, ' ');
}

// ── Comparison ─────────────────────────────────────────────────────────────

/**
 * Compare one field across its sources.
 *
 * Two documents agreeing is corroboration. A document and the administrator
 * agreeing is corroboration. The administrator *alone* is not - that's just
 * an unverified claim, so it lands as UNCORROBORATED.
 */
export function checkField(field: string, values: FieldValue[]): FieldCheck {
  const present = values.filter(
    (v) => v.value !== null && v.value !== undefined && String(v.value).trim() !== '',
  );

  const valuesBySource: Record<string, string | null> = {};
  for (const v of values) {
    valuesBySource[v.source] = v.value == null || String(v.value).trim() === '' ? null : String(v.value);
  }

  if (present.length === 0) {
    return {
      field,
      result: 'DEFERRED',
      detail: 'No source provided a value',
      values_by_source: valuesBySource,
      sources_compared: 0,
    };
  }

  const groups = new Map<string, FieldValue[]>();
  for (const v of present) {
    const key = normalizeField(field, String(v.value));
    const bucket = groups.get(key);
    if (bucket) bucket.push(v);
    else groups.set(key, [v]);
  }

  if (groups.size > 1) {
    const rendered = [...groups.entries()]
      .map(([, vs]) => `${vs.map((v) => v.source).join('+')}="${vs[0].value}"`)
      .join(' vs ');
    return {
      field,
      result: 'INCONSISTENT',
      detail: `Sources disagree: ${rendered}`,
      values_by_source: valuesBySource,
      sources_compared: present.length,
    };
  }

  // Single agreed value. Is it corroborated by more than the applicant's word?
  const documentary = present.filter((v) => v.kind === 'document' || v.kind === 'registry');
  if (present.length >= 2 && documentary.length >= 1) {
    return {
      field,
      result: 'MATCH',
      detail: `Agreed by ${present.length} sources (${present.map((v) => v.source).join(', ')})`,
      values_by_source: valuesBySource,
      sources_compared: present.length,
    };
  }

  if (documentary.length === 1 && present.length === 1) {
    return {
      field,
      result: 'UNCORROBORATED',
      detail: `Only ${present[0].source} provided this value - no second source to confirm it`,
      values_by_source: valuesBySource,
      sources_compared: 1,
    };
  }

  return {
    field,
    result: 'UNCORROBORATED',
    detail: 'Administrator input only - no document corroborates this value',
    values_by_source: valuesBySource,
    sources_compared: present.length,
  };
}

export const CROSS_CHECK_FIELDS = [
  'legal_name',
  'registration_number',
  'company_type',
  'incorporation_date',
  'registered_address',
  'tax_number',
] as const;

export interface CrossCheckInput {
  /** Per-document extracted fields, keyed by document_type. */
  documents: Record<string, Record<string, string | null | undefined>>;
  /** What the administrator typed. */
  userProvided: Record<string, string | null | undefined>;
  /** Registry payload - omitted this release. */
  registry?: Record<string, string | null | undefined> | null;
  fields?: readonly string[];
}

export function runCrossCheck(input: CrossCheckInput): FieldCheck[] {
  const fields = input.fields ?? CROSS_CHECK_FIELDS;
  const out: FieldCheck[] = [];

  for (const field of fields) {
    const values: FieldValue[] = [];

    for (const [docType, extracted] of Object.entries(input.documents)) {
      if (extracted && field in extracted) {
        values.push({ source: docType, kind: 'document', value: extracted[field] });
      }
    }

    if (field in input.userProvided) {
      values.push({ source: 'user_provided', kind: 'user_provided', value: input.userProvided[field] });
    }

    if (input.registry && field in input.registry) {
      values.push({ source: 'registry', kind: 'registry', value: input.registry[field] });
    }

    const check = checkField(field, values);

    // Make the deferred connector explicit in the ledger rather than silently
    // absent - the review table renders this as the "Registry: deferred" cell.
    if (!input.registry) check.values_by_source['registry'] = null;

    out.push(check);
  }

  return out;
}
