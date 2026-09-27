/**
 * OCR display helpers.
 *
 * OCR on national IDs often captures printed field *labels* and neighbouring
 * values as one long string (e.g. "GIVEN NAME NATIONALITY NIN … TUTU MOSES
 * MUGULI CM8808210G1JDF …"). These helpers strip label artifacts and split
 * the remainder into a short person name plus the other identity fields.
 */

// Printed-label vocabulary seen on ID documents (EN + common FR + Swahili).
const LABEL_TOKENS = [
  'surname', 'given names?', 'first name', 'last name', 'family name',
  'full names?', 'name', 'names',
  'sex', 'gender', 'date of birth', 'birth date', 'dob', 'date of birtr',
  'nationality', 'citizenship', 'national id card', 'national id', 'id number', 'id no',
  'serial number', 'serial no', 'document number', 'card no', 'card number',
  'place of birth', 'district of birth', 'place of issue', 'date of issue',
  'date of expiry', 'expiry date', 'expiration', 'nin',
  "holder'?s? sign(?:ature)?", 'signature', 'specimen',
  'jina', 'jinsia', 'tarehe ya kuzaliwa', 'taifa',
  'nom', 'pr[eé]nom', 'sexe', 'date de naissance', 'nationalit[eé]',
];

const LABEL_ONLY_RE = new RegExp(
  `^\\s*(?:(?:${LABEL_TOKENS.join('|')})[\\s:/.,\\-]*)+$`,
  'i',
);

// Longest-first so "national id card" wins over "national id" / "id".
const LABEL_PHRASES = [
  'national id card', 'date of birth', 'date of birtr', 'birth date',
  'date of expiry', 'expiry date', 'date of issue', 'given names',
  'given name', 'first name', 'last name', 'family name', 'full names',
  'full name', 'id number', 'id no', 'card number', 'card no',
  'document number', 'serial number', 'serial no', 'place of birth',
  'district of birth', 'place of issue', 'national id', 'nationality',
  'citizenship', 'surname', 'names', 'name', 'gender', 'sex', 'nin',
  'dob', 'signature', 'specimen', 'expiration',
  'jina', 'jinsia', 'tarehe ya kuzaliwa', 'taifa',
  'prenom', 'prénom', 'nom', 'sexe', 'date de naissance', 'nationalite', 'nationalité',
].sort((a, b) => b.length - a.length);

const LABEL_STRIP_RE = new RegExp(
  `\\b(?:${LABEL_PHRASES.map(escapeRegExp).join('|')})\\b`,
  'gi',
);

const ISO3 = new Set([
  'UGA', 'KEN', 'TZA', 'TZA', 'RWA', 'BDI', 'SSD', 'SSD', 'SOM', 'ETH',
  'ERI', 'SDN', 'COD', 'COG', 'CAF', 'CMR', 'NGA', 'GHA', 'ZAF', 'ZWE',
  'ZMB', 'MWI', 'MOZ', 'AGO', 'NAM', 'BWA', 'LSO', 'SWZ', 'USA', 'GBR',
  'ARE', 'UAE', 'IND', 'CHN', 'FRA', 'DEU', 'CAN', 'AUS', 'NLD', 'BEL',
]);

const ISO2 = new Set([
  'UG', 'KE', 'TZ', 'RW', 'BI', 'SS', 'SO', 'ET', 'ER', 'SD', 'CD', 'CG',
  'CF', 'CM', 'NG', 'GH', 'ZA', 'ZW', 'ZM', 'MW', 'MZ', 'AO', 'NA', 'BW',
  'LS', 'SZ', 'US', 'GB', 'AE', 'IN', 'CN', 'FR', 'DE', 'CA', 'AU', 'NL', 'BE',
]);

export type SanitizedIdentity = {
  name: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  idNumber: string | null;
  sex: string | null;
  expiry: string | null;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v || null;
}

/** True when an extracted value is just field-label text, not real data. */
export function isLabelArtifact(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  return LABEL_ONLY_RE.test(v);
}

export function looksLikeOcrDump(value: string): boolean {
  const v = value.trim();
  if (v.length > 48) return true;
  const hits = (v.match(LABEL_STRIP_RE) || []).length;
  return hits >= 2;
}

function stripLabels(value: string): string {
  return value.replace(LABEL_STRIP_RE, ' ').replace(/[/|,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isDateToken(token: string): boolean {
  return /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(token)
    || /^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(token);
}

function isIdToken(token: string): boolean {
  if (/^\d{6,}$/.test(token)) return true;
  if (/^[A-Z]{1,3}\d{5,}[A-Z0-9]*$/i.test(token)) return true;
  return /^[A-Z0-9]{8,}$/i.test(token) && /\d/.test(token) && /[A-Z]/i.test(token);
}

function isCountryToken(token: string): boolean {
  const upper = token.toUpperCase();
  return (token.length === 3 && ISO3.has(upper)) || (token.length === 2 && ISO2.has(upper));
}

function isNameToken(token: string): boolean {
  if (token.length < 2) return false;
  if (/^[MF]$/i.test(token)) return false;
  if (isDateToken(token) || isIdToken(token) || isCountryToken(token)) return false;
  return /^[A-Za-z][A-Za-z''.-]*$/.test(token);
}

export function titleCaseName(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (part.includes('-')) return part.split('-').map((p) => titleCaseName(p)).join('-');
      if (part.includes("'")) return part.split("'").map((p) => titleCaseName(p)).join("'");
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

function normalizeDate(token: string): string {
  const parts = token.split(/[./-]/);
  if (parts.length !== 3) return token;
  if (parts[0].length === 4) {
    const [y, m, d] = parts;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const [a, b, c] = parts;
  const year = c.length === 2 ? (Number(c) > 30 ? `19${c}` : `20${c}`) : c;
  // Prefer DD.MM.YYYY (common on East African IDs) over MM.DD.YYYY.
  return `${year}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
}

function collectDates(text: string): string[] {
  const matches = text.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/g) || [];
  return matches.map(normalizeDate);
}

function collectIds(text: string): string[] {
  return (text.match(/\b[A-Z]{1,3}\d{5,}[A-Z0-9]*\b|\b\d{7,}\b/gi) || [])
    .filter((token, i, all) => all.findIndex((t) => t.toUpperCase() === token.toUpperCase()) === i);
}

function collectCountry(text: string): string | null {
  const tokens = text.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  for (const token of tokens) {
    if (ISO3.has(token) || ISO2.has(token)) return token;
  }
  return null;
}

function collectSex(text: string): string | null {
  const labeled = text.match(/\b(?:sex|gender|jinsia|sexe)\b[:\s]*([MF]|male|female)\b/i);
  if (labeled) {
    const v = labeled[1].toUpperCase();
    return v.startsWith('M') ? 'M' : 'F';
  }
  return null;
}

/**
 * Pull a short person name out of an OCR value. Mixed label dumps become
 * just the alphabetic name tokens (e.g. "Tutu Moses Muguli").
 */
export function extractPersonName(value: unknown): string | null {
  const raw = asString(value);
  if (!raw || isLabelArtifact(raw)) return null;
  const tokens = stripLabels(raw).split(/\s+/).filter(isNameToken);
  if (tokens.length === 0) return null;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(token);
  }
  return titleCaseName(unique.slice(0, 5).join(' '));
}

export function extractDateValue(value: unknown): string | null {
  const raw = asString(value);
  if (!raw || isLabelArtifact(raw)) return null;
  const dates = collectDates(raw);
  return dates[0] || null;
}

export function extractNationalityValue(value: unknown): string | null {
  const raw = asString(value);
  if (!raw || isLabelArtifact(raw)) return null;
  if (!looksLikeOcrDump(raw) && (raw.length <= 3 || /^[A-Za-z][A-Za-z .'-]{1,32}$/.test(raw))) {
    return raw.length <= 3 ? raw.toUpperCase() : titleCaseName(raw);
  }
  return collectCountry(raw);
}

export function extractIdNumberValue(value: unknown): string | null {
  const raw = asString(value);
  if (!raw || isLabelArtifact(raw)) return null;
  if (!looksLikeOcrDump(raw) && isIdToken(raw.replace(/\s+/g, ''))) return raw.replace(/\s+/g, '').toUpperCase();
  return collectIds(raw)[0]?.toUpperCase() || null;
}

/**
 * Returns the value if it looks like real extracted data, otherwise null.
 * Mixed OCR dumps are reduced to their useful remainder (name-like text).
 */
export function cleanOcrValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || isLabelArtifact(v)) return null;
  if (looksLikeOcrDump(v)) return extractPersonName(v);
  return v;
}

function pick(ocr: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (ocr[key] != null && ocr[key] !== '') return ocr[key];
  }
  return null;
}

/**
 * Build a short, field-separated identity from OCR output. Prefer dedicated
 * fields; fall back to parsing a single dump so each screening input stays
 * in its own box instead of one jumbled subject line.
 */
export function sanitizeOcrIdentity(ocr: Record<string, unknown> | null | undefined): SanitizedIdentity {
  const src = ocr || {};
  const dumpCandidates = [src.full_name, src.name, src.raw_text, src.text]
    .filter((v): v is string => typeof v === 'string' && looksLikeOcrDump(v));
  const dump = dumpCandidates[0] || '';

  const named = extractPersonName(pick(src, 'full_name', 'name'))
    || extractPersonName([src.surname, src.given_names, src.first_name, src.last_name].filter(Boolean).join(' '))
    || extractPersonName(dump);

  const datesFromDump = collectDates(dump);
  const expiryFromDedicated = extractDateValue(pick(src, 'expiry_date', 'expiration_date', 'date_of_expiry'));
  const dobFromDedicated = extractDateValue(pick(src, 'date_of_birth', 'dob', 'birth_date'));

  let dateOfBirth = dobFromDedicated;
  let expiry = expiryFromDedicated;
  if (!dateOfBirth || !expiry) {
    const sorted = [...datesFromDump].sort();
    if (!dateOfBirth && sorted[0]) dateOfBirth = sorted[0];
    if (!expiry && sorted.length > 1) expiry = sorted[sorted.length - 1];
  }

  const nationality = extractNationalityValue(pick(src, 'nationality', 'issuing_country', 'country'))
    || collectCountry(dump);
  const idNumber = extractIdNumberValue(pick(src, 'document_number', 'id_number', 'nin', 'national_id'))
    || collectIds(dump)[0]?.toUpperCase()
    || null;
  const sexRaw = asString(pick(src, 'sex', 'gender'));
  const sex = sexRaw && !looksLikeOcrDump(sexRaw)
    ? (/^f/i.test(sexRaw) ? 'F' : /^m/i.test(sexRaw) ? 'M' : sexRaw)
    : collectSex(dump);

  return {
    name: named,
    dateOfBirth,
    nationality,
    idNumber,
    sex,
    expiry,
  };
}

export function buildScreeningSearchParams(identity: SanitizedIdentity, extra?: Record<string, string | null | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  if (identity.name) params.set('name', identity.name);
  if (identity.dateOfBirth) params.set('dob', identity.dateOfBirth);
  if (identity.nationality) params.set('nationality', identity.nationality);
  if (identity.idNumber) params.set('id_number', identity.idNumber);
  if (identity.sex) params.set('gender', identity.sex === 'M' ? 'male' : identity.sex === 'F' ? 'female' : identity.sex);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value) params.set(key, value);
    }
  }
  return params;
}
