/**
 * Canonical KYB role tags.
 *
 * 15 tags split across ownership and governance. A single person can carry
 * several (director AND signatory AND UBO is common), and still resolves to
 * exactly one linked KYC session - the tags describe what someone does, not
 * how many times we verify them.
 *
 * Whether a tag requires KYC is a *workflow* decision, not a property of the
 * tag, so the defaults here are only defaults. A workflow overrides them.
 */

export const ROLE_TAG_GROUPS = ['ownership', 'governance'] as const;
export type RoleTagGroup = (typeof ROLE_TAG_GROUPS)[number];

export type RoleTag =
  // ownership
  | 'ubo'
  | 'shareholder'
  | 'beneficiary'
  | 'settlor'
  | 'investor'
  | 'trustee'
  | 'corporate_owner'
  // governance
  | 'director'
  | 'chairman'
  | 'secretary'
  | 'signatory'
  | 'founder'
  | 'officer'
  | 'legal_representative'
  | 'partner';

export interface RoleTagDefinition {
  tag: RoleTag;
  group: RoleTagGroup;
  label: string;
  /** Default when a workflow doesn't say otherwise. */
  defaultKycRequired: boolean;
  /** Corporate owners resolve through a nested KYB rather than a person KYC. */
  resolvesToNestedKyb?: boolean;
  /** Ownership tags carry a percentage; governance tags generally don't. */
  carriesOwnership?: boolean;
  description: string;
}

export const ROLE_TAGS: readonly RoleTagDefinition[] = [
  // ── Ownership ────────────────────────────────────────────────────────────
  {
    tag: 'ubo',
    group: 'ownership',
    label: 'UBO',
    defaultKycRequired: true,
    carriesOwnership: true,
    description: 'Ultimate beneficial owner - 25% or more, or effective control by other means.',
  },
  {
    tag: 'shareholder',
    group: 'ownership',
    label: 'Shareholder',
    defaultKycRequired: true,
    carriesOwnership: true,
    description: 'Holds shares directly, individual or corporate.',
  },
  {
    tag: 'beneficiary',
    group: 'ownership',
    label: 'Beneficiary',
    defaultKycRequired: false,
    carriesOwnership: true,
    description: 'Benefits from a trust or similar arrangement.',
  },
  {
    tag: 'settlor',
    group: 'ownership',
    label: 'Settlor',
    defaultKycRequired: false,
    description: 'Established the trust and contributed its assets.',
  },
  {
    tag: 'investor',
    group: 'ownership',
    label: 'Investor',
    defaultKycRequired: false,
    carriesOwnership: true,
    description: 'Holds an economic interest without necessarily holding shares.',
  },
  {
    tag: 'trustee',
    group: 'ownership',
    label: 'Trustee',
    defaultKycRequired: false,
    description: 'Administers assets on behalf of beneficiaries.',
  },
  {
    tag: 'corporate_owner',
    group: 'ownership',
    label: 'Corporate owner',
    defaultKycRequired: false,
    resolvesToNestedKyb: true,
    carriesOwnership: true,
    description: 'Parent company in the ownership chain - resolves via nested KYB, not person KYC.',
  },

  // ── Governance ───────────────────────────────────────────────────────────
  {
    tag: 'director',
    group: 'governance',
    label: 'Director',
    defaultKycRequired: true,
    description: 'Appointed to the board.',
  },
  {
    tag: 'chairman',
    group: 'governance',
    label: 'Chairman',
    defaultKycRequired: true,
    description: 'Chairs the board.',
  },
  {
    tag: 'secretary',
    group: 'governance',
    label: 'Secretary',
    defaultKycRequired: false,
    description: 'Company secretary - statutory filings and records.',
  },
  {
    tag: 'signatory',
    group: 'governance',
    label: 'Signatory',
    defaultKycRequired: false,
    description: 'Authorised to bind the company or operate the account.',
  },
  {
    tag: 'founder',
    group: 'governance',
    label: 'Founder',
    defaultKycRequired: false,
    description: 'Founded the company; may hold no current office.',
  },
  {
    tag: 'officer',
    group: 'governance',
    label: 'Officer',
    defaultKycRequired: false,
    description: 'Senior management not covered by a more specific tag.',
  },
  {
    tag: 'legal_representative',
    group: 'governance',
    label: 'Legal representative',
    defaultKycRequired: false,
    description: 'Empowered to act for the company in legal matters.',
  },
  {
    tag: 'partner',
    group: 'governance',
    label: 'Partner',
    defaultKycRequired: false,
    carriesOwnership: true,
    description: 'Partner in a partnership or unincorporated body.',
  },
] as const;

/** Exactly 15 - asserted in tests so the count can't silently drift. */
export const ROLE_TAG_COUNT = ROLE_TAGS.length;

export const ROLE_TAG_NAMES: readonly RoleTag[] = ROLE_TAGS.map((r) => r.tag);

const BY_TAG = new Map<RoleTag, RoleTagDefinition>(ROLE_TAGS.map((r) => [r.tag, r]));

export function getRoleTag(tag: string): RoleTagDefinition | undefined {
  return BY_TAG.get(tag as RoleTag);
}

export function isRoleTag(tag: string): tag is RoleTag {
  return BY_TAG.has(tag as RoleTag);
}

/**
 * Normalise free-text roles read off a document or typed by an administrator
 * onto the canonical set. Registers say "Managing Director", CR12s say
 * "Company Secretary", people type "owner" - all of it has to land on a tag
 * or the workflow can't decide whether KYC is required.
 *
 * Returns null when there's no confident mapping; the caller should surface
 * that for analyst review rather than guess.
 */
const SYNONYMS: Record<string, RoleTag> = {
  'ubo': 'ubo',
  'ultimate beneficial owner': 'ubo',
  'beneficial owner': 'ubo',
  'owner': 'ubo',
  'shareholder': 'shareholder',
  'share holder': 'shareholder',
  'member': 'shareholder',
  'stockholder': 'shareholder',
  'beneficiary': 'beneficiary',
  'settlor': 'settlor',
  'grantor': 'settlor',
  'investor': 'investor',
  'trustee': 'trustee',
  'corporate owner': 'corporate_owner',
  'corporate shareholder': 'corporate_owner',
  'parent company': 'corporate_owner',
  'holding company': 'corporate_owner',
  'director': 'director',
  'managing director': 'director',
  'executive director': 'director',
  'non-executive director': 'director',
  'board member': 'director',
  'chairman': 'chairman',
  'chairperson': 'chairman',
  'chair': 'chairman',
  'secretary': 'secretary',
  'company secretary': 'secretary',
  'signatory': 'signatory',
  'authorized signatory': 'signatory',
  'authorised signatory': 'signatory',
  'bank signatory': 'signatory',
  'founder': 'founder',
  'co-founder': 'founder',
  'officer': 'officer',
  'senior management': 'officer',
  'ceo': 'officer',
  'chief executive officer': 'officer',
  'cfo': 'officer',
  'legal representative': 'legal_representative',
  'representative': 'legal_representative',
  'partner': 'partner',
  'general partner': 'partner',
  'limited partner': 'partner',
};

export function normalizeRoleTag(raw: string): RoleTag | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (isRoleTag(key.replace(/ /g, '_'))) return key.replace(/ /g, '_') as RoleTag;
  return SYNONYMS[key] ?? null;
}

/** Normalise a list, dropping unmappable entries and de-duplicating. */
export function normalizeRoleTags(raw: string[]): { tags: RoleTag[]; unmapped: string[] } {
  const tags: RoleTag[] = [];
  const unmapped: string[] = [];
  for (const r of raw) {
    const t = normalizeRoleTag(r);
    if (!t) unmapped.push(r);
    else if (!tags.includes(t)) tags.push(t);
  }
  return { tags, unmapped };
}

/**
 * Per-workflow override of which tags require KYC.
 * Shape: { ubo: 'required', secretary: 'off', ... }
 */
export type RoleRequirement = 'required' | 'optional' | 'off';
export type RolePolicy = Partial<Record<RoleTag, RoleRequirement>>;

export function requirementFor(tag: RoleTag, policy: RolePolicy = {}): RoleRequirement {
  const explicit = policy[tag];
  if (explicit) return explicit;
  const def = BY_TAG.get(tag);
  if (!def) return 'off';
  return def.defaultKycRequired ? 'required' : 'optional';
}

/**
 * Does this person need a child KYC session?
 *
 * A person carrying several tags needs ONE session if ANY tag requires it -
 * this is what stops a director-and-UBO being verified twice.
 */
export function personRequiresKyc(tags: RoleTag[], policy: RolePolicy = {}): boolean {
  return tags.some((t) => {
    const def = BY_TAG.get(t);
    if (def?.resolvesToNestedKyb) return false;
    return requirementFor(t, policy) === 'required';
  });
}

/** Corporate owners resolve through a nested business session instead. */
export function personRequiresNestedKyb(tags: RoleTag[]): boolean {
  return tags.some((t) => BY_TAG.get(t)?.resolvesToNestedKyb === true);
}
