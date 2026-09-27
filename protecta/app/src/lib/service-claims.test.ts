import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICING } from 'src/lib/pricing';
import { MemoryDbClient } from 'src/lib/records';
import { advanceClaim, createClaim, decideClaim } from 'src/lib/service-claims';
import { issuePolicy } from 'src/lib/service-policies';
import { createQuote } from 'src/lib/service-quotes';

const seedPolicy = async (db: MemoryDbClient) => {
  const { quote } = await createQuote(
    db,
    { phone: '0772000000', plate: 'UAX 123C', vehicleValue: 10_000_000 },
    { pricing: DEFAULT_PRICING, rng: () => 0.4 },
  );
  return issuePolicy(db, { quoteRef: String(quote.reference), pricing: DEFAULT_PRICING, rng: () => 0.5 });
};

describe('claims', () => {
  it('creates, advances and settles a claim', async () => {
    const db = new MemoryDbClient();
    const { policy } = await seedPolicy(db);
    const { claim } = await createClaim(db, {
      policyNo: String(policy.policyNo),
      description: 'Rear bumper damaged in parking',
      location: 'Kampala',
      reporterPhone: '0772000000',
      rng: () => 0.7,
    });
    expect(claim.status).toBe('REPORTED');

    const assigned = await advanceClaim(db, claim);
    expect(assigned.status).toBe('ASSIGNED');
    const assessed = await advanceClaim(db, assigned);
    expect(assessed.status).toBe('ASSESSED');
    await expect(advanceClaim(db, assessed)).rejects.toThrow('cannot advance');

    const approved = await decideClaim(db, assessed, 'APPROVED', 500_000);
    expect(approved.status).toBe('APPROVED');
    const settled = await advanceClaim(db, approved);
    expect(settled.status).toBe('SETTLED');
  });

  it('requires an active policy', async () => {
    const db = new MemoryDbClient();
    await expect(
      createClaim(db, {
        policyNo: 'PB-2026-000000',
        description: 'Broken mirror on the gate',
        reporterPhone: '0772000000',
      }),
    ).rejects.toThrow('not found');
  });
});
