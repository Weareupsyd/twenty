import { describe, expect, it } from 'vitest';
import { MemoryDbClient } from 'src/lib/records';
import { assembleDocumentData, renderTemplate } from 'src/lib/render';

describe('renderTemplate', () => {
  it('replaces known placeholders and keeps unknown ones visible', () => {
    const out = renderTemplate('Hi {{policyholderName}} / {{mystery}}', {
      policyholderName: 'Sarah Kato',
    });
    expect(out).toBe('Hi Sarah Kato / {{mystery}}');
  });

  it('renders an em dash for known-but-empty values', () => {
    expect(renderTemplate('Vehicle: {{vehicle}}', { vehicle: '' })).toBe(
      'Vehicle: —',
    );
  });
});

describe('assembleDocumentData', () => {
  it('collects policy, quote and person data', async () => {
    const db = new MemoryDbClient();
    const person = await db.create('person', {
      name: { firstName: 'Sarah', lastName: 'Kato' },
    });
    await db.create('insuranceQuote', {
      reference: '123456789012345',
      policyholderId: person.id,
      policyholderPhone: '+256772000000',
    });
    await db.create('insurancePolicy', {
      policyNo: 'PB-2026-004213',
      status: 'ACTIVE',
      plate: 'UAX 123C',
      vehicleMake: 'Toyota',
      vehicleModel: 'Premio',
      premiumUgx: 150000,
      periodStart: '2026-09-28',
      periodEnd: '2027-09-28',
      quoteRef: '123456789012345',
    });
    const { data, error } = await assembleDocumentData(db, {
      policyNo: 'PB-2026-004213',
      reference: 'DOC-000001',
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      policyNo: 'PB-2026-004213',
      reference: 'DOC-000001',
      status: 'ACTIVE',
      policyholderName: 'Sarah Kato',
      policyholderPhone: '+256772000000',
      plate: 'UAX 123C',
      vehicle: 'Toyota Premio',
      premium: 'UGX 150,000',
      quoteRef: '123456789012345',
    });
  });

  it('reports a missing policy', async () => {
    const db = new MemoryDbClient();
    const { data, error } = await assembleDocumentData(db, {
      policyNo: 'PB-0000-000000',
      reference: 'DOC-000001',
    });
    expect(data).toBeNull();
    expect(error).toContain('PB-0000-000000');
  });
});
