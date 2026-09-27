import { type PricingConfig } from 'src/lib/pricing';
import { type DbClient, type RecordData } from 'src/lib/records';
import { confirmPayment } from 'src/lib/service-payments';
import { issuePolicy } from 'src/lib/service-policies';
import { findQuoteByRef } from 'src/lib/service-quotes';

export type ConfirmedIssuance = {
  payment: RecordData;
  quote: RecordData;
  policy: RecordData;
  commission: RecordData | null;
};

/**
 * Confirm a payment and issue its policy (db orchestration only; the caller
 * emits timelines, WhatsApp messages and partner webhooks).
 */
export const confirmAndIssue = async (
  db: DbClient,
  payment: RecordData,
  options: {
    providerRef?: string;
    agentPersonId?: string;
    commissionRate?: number;
    pricing?: PricingConfig;
    baseUrl?: string;
    rng?: () => number;
  } = {},
): Promise<ConfirmedIssuance> => {
  if (String(payment.status) === 'CONFIRMED') {
    const quote = await findQuoteByRef(db, String(payment.quoteRef));
    if (!quote) {
      throw new Error(`Quote ${payment.quoteRef} not found.`);
    }
    const existing = await db.findFirst(
      'insurancePolicies',
      { quoteRef: { eq: String(quote.reference) } },
      ['policyNo'],
    );
    if (!existing) {
      throw new Error(`Payment ${payment.paymentRef} is confirmed but has no policy.`);
    }
    const policyRows = await db.findMany(
      'insurancePolicies',
      { filter: { quoteRef: { eq: String(quote.reference) } }, first: 1 },
      ['policyNo', 'status', 'plate', 'premiumUgx', 'periodStart', 'periodEnd', 'quoteRef'],
    );
    return { payment, quote, policy: policyRows[0], commission: null };
  }

  const confirmed = await confirmPayment(db, payment, options.providerRef);
  const { policy, quote, commission } = await issuePolicy(db, {
    quoteRef: String(payment.quoteRef),
    paymentId: String(payment.id),
    agentPersonId: options.agentPersonId,
    commissionRate: options.commissionRate,
    pricing: options.pricing,
    baseUrl: options.baseUrl,
    rng: options.rng,
  });
  return { payment: confirmed, quote, policy, commission };
};
