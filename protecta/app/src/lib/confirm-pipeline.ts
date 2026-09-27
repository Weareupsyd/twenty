import { type PricingConfig, isQuoteExpired } from 'src/lib/pricing';
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

/** Retryable orchestration. Unique quoteRef on policies prevents duplicate
 * issuance; reruns finish record links after a partially completed operation. */
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
  const quote = await findQuoteByRef(db, String(payment.quoteRef));
  if (!quote) throw new Error(`Quote ${payment.quoteRef} not found.`);
  if (
    !Number.isFinite(Number(payment.amountUgx)) ||
    Number(payment.amountUgx) <= 0 ||
    Number(payment.amountUgx) !== Number(quote.premium)
  ) {
    throw new Error('Payment amount does not match the quoted premium.');
  }
  if (
    payment.status !== 'CONFIRMED' &&
    (quote.status === 'EXPIRED' ||
      isQuoteExpired(String(quote.validUntil ?? '')))
  ) {
    throw new Error('Quote has expired. Manual payment review is required.');
  }
  if ((process.env.REQUIRE_KYC_PURCHASE ?? 'false') === 'true') {
    const person = await db.findFirst(
      'people',
      { protectaPhone: { eq: quote.policyholderPhone } },
      ['protectaKycStatus'],
    );
    if (person?.protectaKycStatus !== 'APPROVED')
      throw new Error('KYC approval is required before policy issuance.');
  }
  const confirmed = await confirmPayment(db, payment, options.providerRef);
  const { policy, commission } = await issuePolicy(db, {
    ...options,
    quoteRef: String(payment.quoteRef),
    paymentId: String(payment.id),
  });
  return { payment: { ...payment, ...confirmed }, quote, policy, commission };
};
