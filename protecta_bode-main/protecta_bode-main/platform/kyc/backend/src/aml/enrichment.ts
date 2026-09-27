import { riskCategoriesFromTopics } from './risk.js';

const CURATED_LABELS: Record<string, string> = {
  name: 'Name', alias: 'Aliases', weakAlias: 'Alternate spellings', previousName: 'Previous names',
  firstName: 'First name', lastName: 'Last name', middleName: 'Middle name',
  fatherName: "Father's name", motherName: "Mother's name", nameSuffix: 'Name suffix',
  birthDate: 'Date of birth', birthPlace: 'Place of birth', birthCountry: 'Country of birth',
  deathDate: 'Date of death', gender: 'Gender', nationality: 'Nationality',
  citizenship: 'Citizenship', country: 'Country', address: 'Address', email: 'Email',
  phone: 'Phone', position: 'Positions held', education: 'Education', profession: 'Profession',
  sector: 'Sector', classification: 'Classification', political: 'Political association',
  notes: 'Notes / description', description: 'Description', summary: 'Summary',
  idNumber: 'ID number', passportNumber: 'Passport number',
  registrationNumber: 'Registration number', taxNumber: 'Tax number',
  incorporationDate: 'Incorporation date', jurisdiction: 'Jurisdiction', website: 'Website',
  wikidataId: 'Wikidata ID', wikipediaUrl: 'Wikipedia Article', sourceUrl: 'Source link',
};

const CURATED_ORDER = Object.keys(CURATED_LABELS);

type RelSpec = [string, string, string | null];
const RELATIONSHIP_PROPERTIES: Record<string, RelSpec> = {
  sanctions: ['sanction', 'Sanction', null],
  familyRelative: ['family', 'Family member', 'person'],
  familyPerson: ['family', 'Family member', 'relative'],
  positionOccupancies: ['position', 'Position held', 'post'],
  associates: ['associate', 'Associate', 'associate'],
  membershipMember: ['membership', 'Member of', 'organization'],
  directorshipDirector: ['directorship', 'Director of', 'organization'],
  ownershipOwner: ['ownership', 'Owner of', 'asset'],
  ownershipAsset: ['ownership', 'Owned by', 'owner'],
  parent: ['ownership', 'Parent company', null],
  subsidiaries: ['ownership', 'Subsidiary', null],
};

const SCALAR_TEXT = new Set(['position', 'political']);

function first(values: unknown): string | null {
  if (!values) return null;
  if (typeof values === 'string') return values || null;
  if (Array.isArray(values)) {
    for (const v of values) {
      if (v !== null && v !== undefined && v !== '') return String(v);
    }
  }
  return null;
}

function join(values: unknown): string {
  if (!values) return '';
  if (typeof values === 'string') return values;
  if (Array.isArray(values)) return values.filter((v) => v !== null && v !== undefined && v !== '').map(String).join(', ');
  return '';
}

function entityLabel(value: unknown): string {
  if (!value || typeof value !== 'object') return value ? String(value) : '';
  const obj = value as Record<string, unknown>;
  if (obj.caption) return String(obj.caption);
  const props = (obj.properties as Record<string, unknown>) || {};
  for (const key of ['name', 'full', 'number', 'registrationNumber', 'email']) {
    const n = first(props[key]);
    if (n) return n;
  }
  return '';
}

export function curateProperties(entity: Record<string, unknown>): Record<string, { label: string; values: unknown[] }> {
  const props = (entity.properties as Record<string, unknown>) || {};
  const curated: Record<string, { label: string; values: unknown[] }> = {};
  for (const prop of CURATED_ORDER) {
    let values = props[prop];
    if (!values) continue;
    if (!Array.isArray(values)) values = [values];
    if (prop in RELATIONSHIP_PROPERTIES && !SCALAR_TEXT.has(prop)) continue;
    const scalar = (values as unknown[]).filter((v) => typeof v !== 'object' || v === null);
    if (!scalar.length) continue;
    curated[prop] = { label: CURATED_LABELS[prop] || prop, values: scalar };
  }
  return curated;
}

export function extractSanctions(entity: Record<string, unknown>): Array<Record<string, unknown>> {
  const props = (entity.properties as Record<string, unknown>) || {};
  const out: Array<Record<string, unknown>> = [];
  for (const s of (props.sanctions as unknown[]) || []) {
    if (!s || typeof s !== 'object') continue;
    const rec = s as Record<string, unknown>;
    const sprops = (rec.properties as Record<string, unknown>) || {};
    out.push({
      entity_id: rec.id || '',
      authority: join(sprops.authority),
      program: join(sprops.program),
      country: join(sprops.country),
      start_date: first(sprops.startDate),
      end_date: first(sprops.endDate),
      reason: join(sprops.reason),
      source_url: first(sprops.sourceUrl) || '',
    });
  }
  return out;
}

export function extractPositions(entity: Record<string, unknown>): string[] {
  const props = (entity.properties as Record<string, unknown>) || {};
  const out: string[] = [];
  const add = (name: unknown) => {
    const t = String(name || '').trim();
    if (t && !out.includes(t)) out.push(t);
  };
  let values = props.position || props.positionHeld || [];
  if (typeof values === 'string') values = [values];
  for (const v of values as unknown[]) {
    if (v && typeof v === 'object') {
      const rec = v as Record<string, unknown>;
      const sprops = (rec.properties as Record<string, unknown>) || {};
      add(rec.caption || first(sprops.name) || first(sprops.role));
    } else if (v) add(v);
  }
  for (const occupancy of (props.positionOccupancies as unknown[]) || []) {
    if (!occupancy || typeof occupancy !== 'object') continue;
    const oprops = ((occupancy as Record<string, unknown>).properties as Record<string, unknown>) || {};
    const postRaw = oprops.post;
    const post = Array.isArray(postRaw) ? postRaw.find((x) => x && typeof x === 'object') : postRaw;
    const name = entityLabel(post);
    if (name) add(name);
  }
  return out;
}

export function extractRelationships(entity: Record<string, unknown>): Array<Record<string, unknown>> {
  const props = (entity.properties as Record<string, unknown>) || {};
  const subjectId = String(entity.id || '');
  const relationships: Array<Record<string, unknown>> = [];
  for (const [prop, [relType, label]] of Object.entries(RELATIONSHIP_PROPERTIES)) {
    let values = props[prop];
    if (!values) continue;
    if (!Array.isArray(values)) values = [values];
    for (const value of values as unknown[]) {
      const rec = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
      const sprops = (rec?.properties as Record<string, unknown>) || {};
      const rel: Record<string, unknown> = {
        relationship_type: relType,
        entity_id: rec?.id || (typeof value === 'string' ? value : ''),
        entity_name: rec ? (relType === 'sanction'
          ? (join(sprops.authority) || join(sprops.program) || rec.caption || '')
          : (entityLabel(rec) || rec.caption || '')) : '',
        risk_categories: riskCategoriesFromTopics(rec?.topics || []),
        source: 'published dataset',
        schema: rec?.schema || '',
        relationship_subtype: label,
        start_date: first(sprops.startDate),
        end_date: first(sprops.endDate),
        country: join(sprops.country),
        authority: join(sprops.authority),
        program: join(sprops.program),
        details: {},
      };
      if (!rel.entity_name && !rel.entity_id) continue;
      if (subjectId && rel.entity_id === subjectId) continue;
      relationships.push(rel);
    }
  }
  return relationships;
}

export function enrichMatch(match: Record<string, unknown>, details: Record<string, unknown>): Record<string, unknown> {
  if (details && Object.keys(details).length) {
    return { ...match, _nested: details };
  }
  return match;
}
