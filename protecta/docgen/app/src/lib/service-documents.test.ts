import { describe, expect, it } from 'vitest';
import { MemoryDbClient } from 'src/lib/records';
import {
  createGeneratedDocument,
  fillGeneratedDocument,
  makeDocRef,
} from 'src/lib/service-documents';
import { DEFAULT_POLICY_TEMPLATE } from 'src/lib/templates';

const seedPolicy = async (db: MemoryDbClient) => {
  const person = await db.create('person', {
    name: { firstName: 'Sarah', lastName: 'Kato' },
    protectaPhone: '+256772000000',
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
};

describe('makeDocRef', () => {
  it('formats DOC-XXXXXX with one draw per digit', () => {
    const draws = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    let next = 0;
    expect(makeDocRef(() => draws[next++ % draws.length])).toBe('DOC-123456');
    expect(makeDocRef()).toMatch(/^DOC-\d{6}$/);
  });
});

describe('createGeneratedDocument', () => {
  it('generates a filled document for a policy', async () => {
    const db = new MemoryDbClient();
    await seedPolicy(db);
    const document = await createGeneratedDocument(db, {
      policyNo: 'PB-2026-004213',
      makeRef: () => 'DOC-000001',
    });
    expect(document).toMatchObject({
      reference: 'DOC-000001',
      status: 'GENERATED',
      error: '',
    });
    const content = String(document.content);
    expect(content).toContain('PB-2026-004213');
    expect(content).toContain('Sarah Kato');
    expect(content).toContain('UAX 123C');
    expect(content).toContain('UGX 150,000');
    expect(content).toContain('DOC-000001');
    // No placeholder survives rendering.
    expect(content).not.toContain('{{');
  });

  it('marks the document failed when the policy does not exist', async () => {
    const db = new MemoryDbClient();
    const document = await createGeneratedDocument(db, {
      policyNo: 'PB-2026-000000',
      makeRef: () => 'DOC-000002',
    });
    expect(document.status).toBe('FAILED');
    expect(String(document.error)).toContain('PB-2026-000000');
  });

  it('uses a staff template body when one exists', async () => {
    const db = new MemoryDbClient();
    await seedPolicy(db);
    await db.create('documentTemplate', {
      name: 'Custom certificate',
      kind: 'POLICY_CERTIFICATE',
      body: 'CUSTOM {{policyNo}} by {{policyholderName}}',
    });
    const document = await createGeneratedDocument(db, {
      policyNo: 'PB-2026-004213',
      makeRef: () => 'DOC-000003',
    });
    expect(String(document.content)).toBe('CUSTOM PB-2026-004213 by Sarah Kato');
  });
});

describe('fillGeneratedDocument', () => {
  it('leaves filled records untouched', async () => {
    const db = new MemoryDbClient();
    await seedPolicy(db);
    const first = await createGeneratedDocument(db, {
      policyNo: 'PB-2026-004213',
      makeRef: () => 'DOC-000004',
    });
    const again = await fillGeneratedDocument(db, first, {
      makeRef: () => 'DOC-999999',
    });
    expect(again.reference).toBe('DOC-000004');
  });

  it('fills a manually created record', async () => {
    const db = new MemoryDbClient();
    await seedPolicy(db);
    const created = await db.create('generatedDocument', {
      reference: '',
      kind: 'POLICY_CERTIFICATE',
      policyNo: 'PB-2026-004213',
      status: 'PENDING',
      content: '',
      error: '',
    });
    const filled = await fillGeneratedDocument(db, created, {
      makeRef: () => 'DOC-000005',
    });
    expect(filled).toMatchObject({
      reference: 'DOC-000005',
      status: 'GENERATED',
    });
    expect(String(filled.content)).toContain('Motor policy certificate');
  });

  it('retries the reference when it collides', async () => {
    const db = new MemoryDbClient();
    await seedPolicy(db);
    const created = await db.create('generatedDocument', {
      reference: '',
      kind: 'POLICY_CERTIFICATE',
      policyNo: 'PB-2026-004213',
      status: 'PENDING',
      content: '',
      error: '',
    });
    // Simulate the unique constraint rejecting the first drawn reference.
    const client = {
      findFirst: db.findFirst.bind(db),
      findMany: db.findMany.bind(db),
      create: db.create.bind(db),
      update: (
        objectSingular: string,
        id: string,
        data: Record<string, unknown>,
      ) => {
        if (data.reference === 'DOC-000001') {
          return Promise.reject(new Error('unique violation'));
        }
        return db.update(objectSingular, id, data);
      },
    };
    let draws = 0;
    const filled = await fillGeneratedDocument(
      client,
      created,
      {
        makeRef: () => `DOC-${String(++draws).padStart(6, '0')}`,
        maxRefAttempts: 3,
      },
    );
    expect(draws).toBe(2);
    expect(filled.reference).toBe('DOC-000002');
    expect(filled.status).toBe('GENERATED');
  });
});

describe('default template', () => {
  it('covers the certificate essentials', () => {
    for (const placeholder of [
      '{{policyNo}}',
      '{{policyholderName}}',
      '{{plate}}',
      '{{premium}}',
      '{{periodStart}}',
      '{{periodEnd}}',
    ]) {
      expect(DEFAULT_POLICY_TEMPLATE).toContain(placeholder);
    }
  });
});
