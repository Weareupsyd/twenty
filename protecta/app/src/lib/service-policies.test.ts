import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICING } from 'src/lib/pricing';
import { MemoryDbClient } from 'src/lib/records';
import {
  ensurePolicyCommission,
  findPolicyByNo,
  issuePolicy,
  renewPolicy,
} from 'src/lib/service-policies';
import { createQuote } from 'src/lib/service-quotes';

const seedQuote = async (db: MemoryDbClient) =>
  createQuote(
    db,
    { phone: '0772000000', name: 'Jane Doe', plate: 'UAX 123C', vehicleValue: 10_000_000 },
    { pricing: DEFAULT_PRICING, rng: () => 0.4 },
  );

describe('ensurePolicyCommission', () => {
  it('creates an agent commission from the agent-specific rate', async () => {
    const db = new MemoryDbClient();
    const agent = await db.create('person', { protectaCommissionRate: 0.12 });
    const policy = await db.create('insurancePolicy', {
      policyNo: 'PB-2026-100001',
      premiumUgx: 200_000,
      agentId: agent.id,
    });

    const commission = await ensurePolicyCommission(db, policy);
    expect(commission?.amountUgx).toBe(24_000);
    expect(commission?.rate).toBe(0.12);
    expect(commission?.beneficiaryId).toBe(agent.id);
    expect(db.store.commissions).toHaveLength(1);

    await ensurePolicyCommission(db, policy);
    expect(db.store.commissions).toHaveLength(1);
  });

  it('uses the workspace default when the agent rate is blank', async () => {
    const db = new MemoryDbClient();
    const previousDefault = process.env.COMMISSION_DEFAULT;
    process.env.COMMISSION_DEFAULT = '0.1';
    try {
      const agent = await db.create('person', { protectaCommissionRate: null });
      const policy = await db.create('insurancePolicy', {
        policyNo: 'PB-2026-100003',
        premiumUgx: 100_000,
        agentId: agent.id,
      });
      const commission = await ensurePolicyCommission(db, policy);
      expect(commission?.rate).toBe(0.1);
      expect(commission?.amountUgx).toBe(10_000);
    } finally {
      if (previousDefault === undefined) delete process.env.COMMISSION_DEFAULT;
      else process.env.COMMISSION_DEFAULT = previousDefault;
    }
  });

  it('creates the commission when an agent is added to an existing policy later', async () => {
    const db = new MemoryDbClient();
    const agent = await db.create('person', { protectaCommissionRate: 0.08 });
    const policy = await db.create('insurancePolicy', {
      policyNo: 'PB-2026-100002',
      premiumUgx: 125_000,
    });

    expect(await ensurePolicyCommission(db, policy)).toBeNull();
    const updatedPolicy = await db.update('insurancePolicy', String(policy.id), {
      agentId: agent.id,
    });
    const commission = await ensurePolicyCommission(db, updatedPolicy);
    expect(commission?.amountUgx).toBe(10_000);
    expect(commission?.beneficiaryId).toBe(agent.id);
  });
});

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

  it('fixes the sum insured at issuance', async () => {
    const db = new MemoryDbClient();
    const { quote } = await seedQuote(db);
    const { policy } = await issuePolicy(db, {
      quoteRef: String(quote.reference),
      pricing: DEFAULT_PRICING,
      rng: () => 0.5,
    });
    expect(policy.sumInsuredUgx).toBe(10_000_000);

    // A later vehicle-value edit must not move an issued certificate.
    await db.update('insuranceQuote', String(quote.id), { vehicleValue: 99_000_000 });
    const stored = await findPolicyByNo(db, String(policy.policyNo));
    expect(stored?.sumInsuredUgx).toBe(10_000_000);
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
