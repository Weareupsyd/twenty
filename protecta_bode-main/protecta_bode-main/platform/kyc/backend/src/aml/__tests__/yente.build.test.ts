import { describe, expect, it } from 'vitest';
import { buildEntityProperties, buildYenteRequest, schemasForEntityType } from '../yente.js';

describe('yente request builder', () => {
  it('maps auto to six schemas', () => {
    expect(schemasForEntityType('auto')).toEqual([
      'Person', 'Company', 'Organization', 'LegalEntity', 'Vessel', 'Airplane',
    ]);
  });

  it('maps person to Person only', () => {
    expect(schemasForEntityType('person')).toEqual(['Person']);
  });

  it('builds FtM properties from a screen request', () => {
    const props = buildEntityProperties({
      entity_type: 'person',
      name: 'Jane Doe',
      country: 'UG',
      aliases: ['J. Doe'],
      date_of_birth: '1990-01-01',
      nationality: 'UG',
      gender: null,
      address: null,
      registration_number: null,
      tax_number: null,
      incorporation_date: null,
      jurisdiction: null,
      threshold: 0.82,
      include_relationships: true,
      include_source_documents: true,
      requested_by: null,
    });
    expect(props.name).toEqual(['Jane Doe']);
    expect(props.country).toEqual(['ug']);
    expect(props.alias).toEqual(['J. Doe']);
    expect(props.birthDate).toEqual(['1990-01-01']);
  });

  it('emits one yente query per schema', () => {
    const body = buildYenteRequest({
      entity_type: 'company',
      name: 'Acme Ltd',
      aliases: [],
      threshold: 0.8,
      include_relationships: true,
      include_source_documents: true,
    });
    expect(Object.keys(body.queries)).toEqual(['q0', 'q1']);
    expect(body.queries.q0.schema).toBe('Company');
    expect(body.queries.q1.schema).toBe('LegalEntity');
    expect(body.threshold).toBe(0.8);
    expect(body.limit).toBe(25);
  });
});
