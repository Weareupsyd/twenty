/** Pure mappers for the combined subject file. Kept free of I/O so vitest can lock the contract. */

import { firstString } from './query.js';
import { shortRef } from './ids.js';

export type DecisionKind = 'approve' | 'reject' | 'escalate';

export type IdentityField = {
  field: string;
  submitted: string | null;
  extracted: string | null;
  match: 'exact' | 'partial' | 'mismatch' | 'n/a';
};

export type ScreeningMatchView = {
  entity_id: string;
  caption: string;
  dataset: string;
  type: string;
  score: number;
  basis: string;
  disposition: 'review' | 'discounted' | 'clear';
};

export type AuditEvent = {
  at: string;
  title: string;
  detail: string;
};

export type SubjectSummary = {
  id: string;
  ref: string;
  kind: 'individual' | 'business';
  name: string;
  country: string | null;
  verification: string;
  screening: string;
  risk: number | null;
  submitted_at: string | null;
  decision: string;
  screening_ref: string | null;
  /**
   * True when this row is backed by a real verification_requests record, and
   * can therefore be voided ("deleted") or have its hosted link extended.
   * Screening-only rows and business sessions are not.
   */
  deletable: boolean;
  /** Hosted link expiry, when this row has one. Drives the "expired" badge. */
  expires_at: string | null;
  /** External correlation reference (e.g. odoo-kyc-case-123), searchable. */
  external_reference?: string | null;
};

function norm(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

export function fieldMatch(submitted: string | null, extracted: string | null): IdentityField['match'] {
  if (!submitted && !extracted) return 'n/a';
  if (!submitted || !extracted) return 'n/a';
  const a = norm(submitted);
  const b = norm(extracted);
  if (a === b) return 'exact';
  if (a.length > 2 && b.length > 2 && (a.includes(b) || b.includes(a))) return 'partial';
  return 'mismatch';
}

export function mapVerificationLabel(status: string | null | undefined): string {
  const s = (status || '').toLowerCase();
  if (s === 'verified' || s === 'approved') return 'passed';
  if (s === 'failed' || s === 'declined' || s === 'rejected') return 'failed';
  if (s === 'manual_review' || s === 'in_review') return 'review';
  if (!s || s === 'pending' || s === 'not_started' || s === 'in_progress') return 'pending';
  return s;
}

export function mapScreeningLabel(opts: {
  riskLevel?: string | null;
  matchFound?: boolean | null;
  topics?: unknown;
}): string {
  if (!opts.riskLevel && opts.matchFound == null) return 'not run';
  const cats = Array.isArray(opts.topics)
    ? opts.topics.map((t) => String(t).toLowerCase())
    : [];
  if (cats.some((t) => t.startsWith('sanction')) && (opts.matchFound || Number(opts.riskLevel === 'Critical'))) {
    return 'sanctions';
  }
  if (cats.some((t) => t.startsWith('pep'))) return 'PEP match';
  const level = opts.riskLevel || '';
  if (level === 'Critical' || level === 'High') return opts.matchFound ? 'hit' : level.toLowerCase();
  if (level === 'Medium') return 'review';
  if (level === 'Clear' || level === 'Low' || !opts.matchFound) return 'clear';
  return 'review';
}

export function mapDecisionLabel(decision: string | null | undefined, fallback: string): string {
  const d = (decision || '').toLowerCase();
  if (d === 'approve' || d === 'approved') return 'approved';
  if (d === 'reject' || d === 'rejected' || d === 'declined') return 'rejected';
  if (d === 'escalate' || d === 'escalated') return 'escalated';
  return fallback;
}

export function inferDecision(opts: {
  recorded?: string | null;
  verification?: string | null;
  screening?: string | null;
}): string {
  if (opts.recorded) return mapDecisionLabel(opts.recorded, 'in review');
  const screen = (opts.screening || '').toLowerCase();
  if (screen === 'sanctions' || screen === 'hit') return 'in review';
  if (screen === 'pep match') return 'in review';
  const ver = mapVerificationLabel(opts.verification);
  if (ver === 'failed') return 'rejected';
  if (ver === 'passed' && (screen === 'clear' || screen === 'not run')) return screen === 'clear' ? 'approved' : 'in review';
  return 'in review';
}

export function riskScore(maxScore: number | null | undefined, riskLevel?: string | null): number | null {
  if (maxScore === null || maxScore === undefined) {
    if (!riskLevel || riskLevel === 'Clear') return null;
    return null;
  }
  const n = Number(maxScore);
  if (Number.isNaN(n)) return null;
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

export function sanitizeFieldValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  // Filter pure label noise / headers OCR'd as values
  if (/^(?:sex|gender|jinsia|date\s*of\s*birth|dob|birth\s*date|nationality|citizenship|surname|given\s*names?|full\s*names?|card\s*no|document\s*number|expiry|date\s*of\s*expiry)(?:\s*[/:\-]\s*(?:sex|gender|jinsia|date\s*of\s*birth|dob|birth\s*date|nationality|citizenship|surname|given\s*names?|full\s*names?|card\s*no|document\s*number|expiry|date\s*of\s*expiry))*$/i.test(v)) {
    return null;
  }
  return v;
}

export function compareIdentity(opts: {
  submitted: Record<string, unknown>;
  extracted: Record<string, unknown>;
}): IdentityField[] {
  const rows: Array<[string, string[]]> = [
    ['Full name', ['full_name', 'name', 'fullName', 'formatted_name']],
    ['Date of birth', ['date_of_birth', 'dob', 'birthDate', 'dateOfBirth', 'birth_date']],
    ['Age / Estimate', ['age_display', 'age_estimation', 'declared_age', 'age', 'calculated_age']],
    ['Document', ['document_type', 'documentType', 'doc_type', 'type', 'detected_document_type']],
    ['Document number', ['document_number', 'documentNumber', 'id_number', 'idNumber', 'nin', 'card_number', 'card_no', 'doc_number', 'license_number', 'passport_number', 'serial_number']],
    ['Expiry', ['expiration_date', 'expiry_date', 'expiry', 'date_of_expiry', 'expirationDate', 'expires', 'valid_until']],
    ['Nationality', ['nationality', 'country', 'issuing_country', 'citizenship']],
    ['Sex / Gender', ['sex', 'gender', 'gjinja']],
    ['Address', ['address', 'residence', 'full_address']],
    ['Phone', ['phone', 'phone_number', 'mobile', 'telephone']],
  ];
  return rows.map(([label, keys]) => {
    let submitted = sanitizeFieldValue(firstString(...keys.map((k) => opts.submitted[k]))) || null;
    let extracted = sanitizeFieldValue(firstString(...keys.map((k) => opts.extracted[k]))) || null;
    return { field: label, submitted, extracted, match: fieldMatch(submitted, extracted) };
  });
}

export function matchDisposition(score: number, threshold = 0.85): ScreeningMatchView['disposition'] {
  if (score >= threshold) return 'review';
  if (score >= 0.6) return 'discounted';
  return 'clear';
}

export function matchType(topics: unknown): string {
  const list = Array.isArray(topics) ? topics.map((t) => String(t).toLowerCase()) : [];
  if (list.some((t) => t.startsWith('sanction'))) return 'Sanction';
  if (list.some((t) => t.startsWith('pep'))) return 'PEP';
  if (list.some((t) => t.includes('crime') || t.includes('media'))) return 'Media';
  if (list.some((t) => t.startsWith('wanted'))) return 'Wanted';
  if (list.some((t) => t.startsWith('debarment'))) return 'Debarment';
  return 'Other';
}

export function shapeMatch(raw: Record<string, unknown>, threshold = 0.85): ScreeningMatchView {
  const topics = raw.topics || raw.risk_categories;
  const datasets = raw.datasets;
  const dataset = Array.isArray(datasets) && datasets.length ? String(datasets[0]) : String(raw.dataset || 'OpenSanctions');
  const score = Number(raw.score || 0);
  const caption = String(raw.caption || raw.name || raw.entity_id || '');
  return {
    entity_id: String(raw.entity_id || raw.id || ''),
    caption,
    dataset,
    type: matchType(topics),
    score: Math.round(score * 10000) / 10000,
    basis: String(raw.basis || raw.match_explanation || (score >= 0.85 ? 'name + identifiers' : 'name only')),
    disposition: matchDisposition(score, threshold),
  };
}

export function toSummary(row: {
  id: string;
  kind: 'individual' | 'business';
  name: string;
  country?: string | null;
  verificationStatus?: string | null;
  screeningRisk?: string | null;
  matchFound?: boolean | null;
  topics?: unknown;
  maxScore?: number | null;
  submittedAt?: string | Date | null;
  recordedDecision?: string | null;
  screeningRef?: string | null;
  deletable?: boolean;
  expiresAt?: string | Date | null;
  externalReference?: string | null;
}): SubjectSummary {
  const screening = mapScreeningLabel({
    riskLevel: row.screeningRisk,
    matchFound: row.matchFound,
    topics: row.topics,
  });
  return {
    id: row.id,
    ref: shortRef(row.kind === 'business' ? 'BUS' : 'SUB', row.id),
    kind: row.kind,
    name: row.name,
    country: row.country || null,
    verification: mapVerificationLabel(row.verificationStatus),
    screening,
    risk: riskScore(row.maxScore ?? null, row.screeningRisk),
    submitted_at: row.submittedAt ? new Date(row.submittedAt).toISOString() : null,
    decision: inferDecision({
      recorded: row.recordedDecision,
      verification: row.verificationStatus,
      screening,
    }),
    screening_ref: row.screeningRef || null,
    deletable: Boolean(row.deletable),
    expires_at: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    external_reference: row.externalReference || null,
  };
}

export function normalizeDecision(value: string): DecisionKind {
  const v = value.trim().toLowerCase();
  if (v === 'approve' || v === 'approved' || v === 'approve_edd') return 'approve';
  if (v === 'reject' || v === 'rejected' || v === 'decline' || v === 'declined') return 'reject';
  if (v === 'escalate' || v === 'escalated') return 'escalate';
  throw Object.assign(new Error('decision must be approve, reject, or escalate'), { status: 422 });
}

export type FanoutTarget = {
  kind: 'company' | 'person';
  name: string;
  date_of_birth?: string | null;
  country?: string | null;
  role_tags: string[];
  ownership_pct?: number | null;
  key_person_id?: string | null;
};

export function planFanout(
  session: { legal_name?: string | null; jurisdiction?: string | null; user_provided_data?: Record<string, unknown> | null },
  people: Array<{
    id?: string;
    full_name: string;
    date_of_birth?: string | null;
    nationality?: string | null;
    role_tags?: string[] | null;
    ownership_percentage?: number | null;
    is_corporate?: boolean | null;
  }>,
): FanoutTarget[] {
  const targets: FanoutTarget[] = [];
  const provided = session.user_provided_data || {};
  const companyName = session.legal_name || firstString(provided.legal_name, provided.name);
  if (companyName) {
    targets.push({
      kind: 'company',
      name: companyName,
      country: session.jurisdiction || firstString(provided.jurisdiction, provided.country) || null,
      role_tags: [],
    });
  }
  for (const person of people) {
    if (!person.full_name) continue;
    targets.push({
      kind: person.is_corporate ? 'company' : 'person',
      name: person.full_name,
      date_of_birth: person.date_of_birth || null,
      country: person.nationality || null,
      role_tags: person.role_tags || [],
      ownership_pct: person.ownership_percentage ?? null,
      key_person_id: person.id || null,
    });
  }
  return targets;
}

export function formatEat(iso: string | Date | null | undefined): string {
  if (!iso) return '-';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}
