import { describe, expect, it } from 'vitest';
import { fillMissingRef } from 'src/lib/generate-ref';
import { MemoryDbClient } from 'src/lib/records';

const claimConfig = {
  objectSingular: 'insuranceClaim',
  refField: 'claimRef',
  makeRef: () => 'CLM-12345678',
};

describe('fillMissingRef', () => {
  it('generates the reference for a record created without one', async () => {
    const db = new MemoryDbClient();
    const created = await db.create('insuranceClaim', {
      policyNo: 'PB-2026-000001',
      status: 'REPORTED',
    });
    const result = await fillMissingRef(db, created, claimConfig);
    expect(result).toEqual({ processed: true, ref: 'CLM-12345678' });
    expect(db.store.insuranceClaims[0]).toMatchObject({
      claimRef: 'CLM-12345678',
      protectaRef: 'CLM-12345678',
    });
  });

  it('leaves service-created records untouched', async () => {
    const db = new MemoryDbClient();
    const created = await db.create('insuranceClaim', {
      claimRef: 'CLM-87654321',
      protectaRef: 'CLM-87654321',
    });
    const result = await fillMissingRef(db, created, claimConfig);
    expect(result).toEqual({ processed: false, ref: 'CLM-87654321' });
    expect(db.store.insuranceClaims[0].claimRef).toBe('CLM-87654321');
  });

  it('never overwrites an existing protectaRef', async () => {
    const db = new MemoryDbClient();
    const created = await db.create('insuranceClaim', {
      protectaRef: 'legacy-key',
    });
    await fillMissingRef(db, created, claimConfig);
    expect(db.store.insuranceClaims[0]).toMatchObject({
      claimRef: 'CLM-12345678',
      protectaRef: 'legacy-key',
    });
  });

  it('draws another reference when the first one is rejected', async () => {
    const db = new MemoryDbClient();
    const created = await db.create('insuranceClaim', {});
    let draws = 0;
    let updates = 0;
    const result = await fillMissingRef(
      {
        update: async (objectSingular: string, id: string, data: Record<string, unknown>) => {
          updates += 1;
          if (updates === 1) throw new Error('unique violation');
          return db.update(objectSingular, id, data);
        },
      } as never,
      created,
      {
        ...claimConfig,
        makeRef: () => `CLM-${String(++draws).padStart(8, '0')}`,
      },
    );
    expect(updates).toBe(2);
    expect(result).toEqual({ processed: true, ref: 'CLM-00000002' });
    expect(db.store.insuranceClaims[0]).toMatchObject({
      claimRef: 'CLM-00000002',
      protectaRef: 'CLM-00000002',
    });
  });

  it('retries after a failed update and surfaces the last error', async () => {
    const created = { id: 'claim-1' };
    let calls = 0;
    const failing = {
      update: async () => {
        calls += 1;
        throw new Error('unique violation');
      },
    };
    await expect(
      fillMissingRef(
        failing as never,
        created,
        {
          ...claimConfig,
          makeRef: () => `CLM-${String(calls).padStart(8, '0')}`,
        },
        { maxAttempts: 2 },
      ),
    ).rejects.toThrow('unique violation');
    expect(calls).toBe(2);
  });
});
