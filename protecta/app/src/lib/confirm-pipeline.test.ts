import { describe, expect, it } from 'vitest';
import { confirmAndIssue } from 'src/lib/confirm-pipeline';
import { DEFAULT_PRICING } from 'src/lib/pricing';
import { MemoryDbClient } from 'src/lib/records';
import { createPayment } from 'src/lib/service-payments';
import { createQuote } from 'src/lib/service-quotes';

describe('confirmAndIssue', () => {
  it('confirms payment and issues policy with commission', async () => {
    const db = new MemoryDbClient();
    const { quote } = await createQuote(
      db,
      { phone: '0772000000', plate: 'UAX 123C', vehicleValue: 10_000_000 },
      { pricing: DEFAULT_PRICING, rng: () => 0.4 },
    );
    const payment = await createPayment(db, {
      quoteId: String(quote.id),
      quoteRef: String(quote.reference),
      amountUgx: 150_000,
      provider: 'mtn_momo',
      payerPhone: '0772000000',
      rng: () => 0.5,
    });

    const result = await confirmAndIssue(db, payment, {
      providerRef: 'momo-123',
      agentPersonId: 'agent-1',
      pricing: DEFAULT_PRICING,
      rng: () => 0.6,
    });

    expect(result.payment.status).toBe('CONFIRMED');
    expect(result.policy.status).toBe('ACTIVE');
    expect(result.commission?.amountUgx).toBe(15_000);
  });

  it('is idempotent for already-confirmed payments', async () => {
    const db = new MemoryDbClient();
    const { quote } = await createQuote(
      db,
      { phone: '0772000000', plate: 'UAX 123C', vehicleValue: 10_000_000 },
      { pricing: DEFAULT_PRICING, rng: () => 0.4 },
    );
    const payment = await createPayment(db, {
      quoteId: String(quote.id),
      quoteRef: String(quote.reference),
      amountUgx: 150_000,
      provider: 'bank',
      payerPhone: '0772000000',
      rng: () => 0.5,
    });
    const first = await confirmAndIssue(db, payment, { pricing: DEFAULT_PRICING, rng: () => 0.6 });
    const stored = await db.findFirst('insurancePayments', { paymentRef: { eq: payment.paymentRef } }, ['status']);
    const second = await confirmAndIssue(db, { ...payment, ...stored }, { pricing: DEFAULT_PRICING });
    expect(second.policy.policyNo).toBe(first.policy.policyNo);
  });
});
