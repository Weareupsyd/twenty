import { describe, expect, it } from 'vitest';
import { MemoryDbClient } from 'src/lib/records';
import {
  createGeneratedDocument,
  fillGeneratedDocument,
  makeDocRef,
} from 'src/lib/service-documents';
import {
  DEFAULT_POLICY_TEMPLATE,
  DEFAULT_POLICY_TEMPLATE_HTML,
  PLACEHOLDERS,
} from 'src/lib/templates';
import { POLICY_TEMPLATE_NAME, POLICY_TEMPLATE_BODY } from 'src/lib/policy-template';
import { htmlToText } from 'src/lib/html';
import { scheduleConfigFromEnv } from 'src/lib/render';

const seedPolicy = async (db: MemoryDbClient) => {
  const person = await db.create('person', {
    name: { firstName: 'Sarah', lastName: 'Kato' },
    protectaPhone: '+256772000000',
    protectaAddress: 'Plot 12, Kampala Road, Kampala',
    protectaOccupation: 'Transport and logistics',
  });
  await db.create('vehicle', {
    plate: 'UAX 123C',
    make: 'Toyota',
    model: 'Premio',
    year: 2016,
    valueUgx: 10_000_000,
    bodyType: 'Saloon',
    engineCc: 1800,
    seatingCapacity: 5,
  });
  await db.create('insuranceQuote', {
    reference: '123456789012345',
    policyholderId: person.id,
    policyholderPhone: '+256772000000',
    vehicleValue: 10_000_000,
    createdAt: '2026-09-20T09:00:00.000Z',
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
  it('generates the full policy document for a policy', async () => {
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
    const text = htmlToText(content).replace(/\s+/g, ' ');

    // The Word-exported policy document is stored as HTML, not retyped text.
    expect(document.format).toBe('HTML');
    expect(text).toContain('MOTOR PROTECTA BODE POLICY SCHEDULE');
    expect(text).toContain('PREMIUM PAYMENT WARRANTY');
    expect(text).toContain('GENERAL CONDITIONS');
    expect(text).toContain('ENDORSEMENTS');

    // Schedule values filled from the Protecta records.
    expect(text).toContain('PB-2026-004213');
    expect(text).toContain('Sarah Kato');
    expect(text).toContain('Plot 12, Kampala Road, Kampala');
    expect(text).toContain('Transport and logistics');
    expect(text).toContain('UAX 123C');
    expect(text).toContain('Toyota Premio');
    expect(text).toContain('Saloon');
    expect(text).toContain('1800');
    expect(text).toContain('150,000');
    // Sum insured falls back to the quote's vehicle value.
    expect(text).toContain('10,000,000');
    expect(text).toContain('2026-09-20'); // proposal date from the quote

    // No placeholder survives rendering, and no broken cover image is referenced.
    expect(content).not.toContain('{{');
    expect(content).not.toContain('image001.png');
  });

  it('upgrades the previously installed built-in text template without replacing custom templates', async () => {
    const db = new MemoryDbClient();
    await seedPolicy(db);
    await db.create('documentTemplate', {
      name: POLICY_TEMPLATE_NAME,
      kind: 'POLICY_CERTIFICATE',
      format: 'TEXT',
      body: POLICY_TEMPLATE_BODY,
    });

    const document = await createGeneratedDocument(db, {
      policyNo: 'PB-2026-004213',
      makeRef: () => 'DOC-000009',
    });

    expect(document.format).toBe('HTML');
    expect(String(document.content)).toContain('<table');
    expect(String(document.content)).toContain('PB-2026-004213');
  });

  it('prints an em dash for schedule values the CRM does not hold', async () => {
    const db = new MemoryDbClient();
    await seedPolicy(db);
    const document = await createGeneratedDocument(db, {
      policyNo: 'PB-2026-004213',
      makeRef: () => 'DOC-000010',
    });
    const text = htmlToText(String(document.content)).replace(/\s+/g, ' ');
    expect(text).toMatch(/Training Levy\s+—/);
    expect(text).toMatch(/Sticker fees\s+6,000/);
    expect(text).toMatch(/S\/Duty\s+35,000/);
    expect(text).toMatch(/Total\s+191,000/);
  });

  it('uses the deployment rates and amounts for the premium breakdown', async () => {
    const db = new MemoryDbClient();
    await seedPolicy(db);
    const document = await createGeneratedDocument(db, {
      policyNo: 'PB-2026-004213',
      makeRef: () => 'DOC-000011',
      config: {
        trainingLevyRate: 0.005,
        vatRate: 0.18,
        stickerFeesUgx: 6000,
        stampDutyUgx: 35000,
      },
    });
    const content = String(document.content);
    const text = htmlToText(content);
    expect(text).toContain('750');
    expect(text).toContain('27,000');
    expect(text).toContain('6,000');
    expect(text).toContain('35,000');
    expect(text).toContain('218,750');
  });

  it('prefers recorded per-policy amounts over the deployment rates', async () => {
    const db = new MemoryDbClient();
    await seedPolicy(db);
    const policy = await db.findFirst(
      'insurancePolicies',
      { policyNo: { eq: 'PB-2026-004213' } },
      ['id'],
    );
    await db.update('insurancePolicy', String(policy?.id), {
      trainingLevyUgx: 900,
      vatUgx: 1_000,
      stickerFeesUgx: 6_000,
      stampDutyUgx: 35_000,
      totalPremiumUgx: 200_000,
    });
    const document = await createGeneratedDocument(db, {
      policyNo: 'PB-2026-004213',
      makeRef: () => 'DOC-000012',
      config: {
        trainingLevyRate: 0.005,
        vatRate: 0.18,
        stickerFeesUgx: 1,
        stampDutyUgx: 1,
      },
    });
    const content = String(document.content);
    const text = htmlToText(content);
    expect(text).toContain('900');
    expect(text).toContain('6,000');
    expect(text).toContain('200,000');
  });

  it('reads a deployment setting of 0 as "not recorded"', () => {
    const config = scheduleConfigFromEnv({
      POLICY_TRAINING_LEVY_RATE: '0',
      POLICY_VAT_RATE: '',
      POLICY_STICKER_FEES_UGX: '6000',
    } as NodeJS.ProcessEnv);
    expect(config.trainingLevyRate).toBeNull();
    expect(config.vatRate).toBeNull();
    expect(config.stickerFeesUgx).toBe(6000);
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

  it('stores the template format on the document', async () => {
    const db = new MemoryDbClient();
    await seedPolicy(db);
    await db.create('documentTemplate', {
      name: 'HTML certificate',
      kind: 'POLICY_CERTIFICATE',
      format: 'HTML',
      body: '<h1>{{policyNo}}</h1><p>{{policyholderName}}</p>',
    });
    const document = await createGeneratedDocument(db, {
      policyNo: 'PB-2026-004213',
      makeRef: () => 'DOC-000006',
    });
    expect(document.format).toBe('HTML');
    expect(String(document.content)).toBe(
      '<h1>PB-2026-004213</h1><p>Sarah Kato</p>',
    );
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
    expect(String(filled.content)).toContain('MOTOR PROTECTA');
    expect(String(filled.content)).toContain('POLICY SCHEDULE');
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
    const filled = await fillGeneratedDocument(client, created, {
      makeRef: () => `DOC-${String(++draws).padStart(6, '0')}`,
      maxRefAttempts: 3,
    });
    expect(draws).toBe(2);
    expect(filled.reference).toBe('DOC-000002');
    expect(filled.status).toBe('GENERATED');
  });
});

describe('default policy template', () => {
  it('uses the Word-exported HTML with schedule placeholders and no missing image asset', () => {
    expect(DEFAULT_POLICY_TEMPLATE_HTML).toContain('@page WordSection1');
    expect(DEFAULT_POLICY_TEMPLATE_HTML).toContain('page-break-after:avoid');
    expect(DEFAULT_POLICY_TEMPLATE_HTML).toContain('{{policyholderName}}');
    expect(DEFAULT_POLICY_TEMPLATE_HTML).toContain('{{totalPremiumAmount}}');
    expect(DEFAULT_POLICY_TEMPLATE_HTML).not.toContain('image001.png');
    expect(DEFAULT_POLICY_TEMPLATE_HTML).not.toContain('P/HQ/BODE/26/000008');
  });

  it('is the full policy document, not a certificate summary', () => {
    expect(DEFAULT_POLICY_TEMPLATE).toContain('MOTOR PROTECTA BODE POLICY SCHEDULE');
    expect(DEFAULT_POLICY_TEMPLATE).toContain('GENERAL EXCLUSIONS');
    expect(DEFAULT_POLICY_TEMPLATE).toContain('ENDORSEMENTS');
    expect(DEFAULT_POLICY_TEMPLATE.length).toBeGreaterThan(20000);
  });

  it('covers the certificate essentials', () => {
    for (const placeholder of [
      '{{policyNo}}',
      '{{policyholderName}}',
      '{{plate}}',
      '{{premium}}',
      '{{periodStart}}',
      '{{periodEnd}}',
      '{{sumInsured}}',
      '{{bodyType}}',
      '{{engineCc}}',
      '{{seatingCapacity}}',
      '{{totalPremium}}',
    ]) {
      expect(DEFAULT_POLICY_TEMPLATE).toContain(placeholder);
    }
  });

  it('documents every placeholder it uses, and uses only documented ones', () => {
    const documented = new Set(PLACEHOLDERS.map((entry) => entry.key));
    const used = [
      ...DEFAULT_POLICY_TEMPLATE.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g),
    ].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(20);
    for (const key of new Set(used)) {
      expect(documented.has(key)).toBe(true);
    }
    // And the other way around: no documented key without a value.
    for (const key of documented) {
      expect(PLACEHOLDERS.find((entry) => entry.key === key)?.description).toBeTruthy();
    }
  });

  it('describes every placeholder it documents', () => {
    for (const entry of PLACEHOLDERS) {
      expect(entry.description.length).toBeGreaterThan(5);
    }
  });
});
