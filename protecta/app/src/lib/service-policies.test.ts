import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICING } from 'src/lib/pricing';
import { MemoryDbClient } from 'src/lib/records';
import { findPolicyByNo, issuePolicy, renewPolicy } from 'src/lib/service-policies';
import { createQuote } from 'src/lib/service-quotes';

const seedQuote = async (db: MemoryDbClient) =>
  createQuote(
    db,
    { phone: '0772000000', name: 'Jane Doe', plate: 'UAX 123C', vehicleValue: 10_000_000 },
    { pricing: DEFAULT_PRICING, rng: () => 0.4 },
  );

describe('issuePolicy', () => {
  it('issues an active policy and accepts the quote', async () => {
    const db = new MemoryDbClient();
    const { quote } = await seedQuote(db);
    const { policy, commission } = await issuePolicy(db, {
      quoteRef: String(quote.reference),
      agentPersonId: 'agent-1',
      commissionRate: 0.1,
      pricing: DEFAULT_PRICING,
      rng: () => 0.5,
    });

    expect(policy.status).toBe('ACTIVE');
    expect(String(policy.policyNo)).toMatch(/^PB-\d{4}-\d{6}$/);
    expect(policy.premiumUgx).toBe(150_000);
    expect(commission?.amountUgx).toBe(15_000);
    expect(commission?.status).toBe('ACCRUED');

    const stored = await findPolicyByNo(db, String(policy.policyNo));
    expect(stored?.quoteRef).toBe(quote.reference);
  });

  it('refuses expired quotes', async () => {
    const db = new MemoryDbClient();
    const { quote } = await seedQuote(db);
    await db.update('insuranceQuote', String(quote.id), { status: 'EXPIRED' });
    await expect(
      issuePolicy(db, { quoteRef: String(quote.reference), pricing: DEFAULT_PRICING }),
    ).rejects.toThrow('expired');
  });

  it('renews a policy into a fresh quote', async () => {
    const db = new MemoryDbClient();
    const { quote } = await seedQuote(db);
    const { policy } = await issuePolicy(db, {
      quoteRef: String(quote.reference),
      pricing: DEFAULT_PRICING,
      rng: () => 0.5,
    });
    const renewal = await renewPolicy(db, String(policy.policyNo), { rng: () => 0.6 });
    expect(renewal.quote.status).toBe('QUOTED');
    expect(renewal.quote.plate).toBe('UAX 123C');
    expect(renewal.quote.premium).toBe(150_000);
  });
});
