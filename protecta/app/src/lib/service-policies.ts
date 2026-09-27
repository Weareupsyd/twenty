import { policyPeriod, pricingFromEnv, type PricingConfig } from 'src/lib/pricing';
import { makePolicyNo, makeQuoteRef } from 'src/lib/refs';
import { statementMonth } from 'src/lib/reports';
import { type DbClient, type RecordData } from 'src/lib/records';
import { findQuoteByRef, quoteShareUrl } from 'src/lib/service-quotes';

export const policyCertUrl = (baseUrl: string, policyNo: string): string => {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/s/protecta/policies/doc?ref=${encodeURIComponent(policyNo)}`;
};

export type IssuePolicyInput = {
  quoteRef: string;
  paymentId?: string;
  agentPersonId?: string;
  commissionRate?: number;
  pricing?: PricingConfig;
  baseUrl?: string;
  rng?: () => number;
};

export type IssuedPolicy = {
  policy: RecordData;
  quote: RecordData;
  commission: RecordData | null;
};

export const issuePolicy = async (
  db: DbClient,
  input: IssuePolicyInput,
): Promise<IssuedPolicy> => {
  const pricing = input.pricing ?? pricingFromEnv();
  const quote = await findQuoteByRef(db, input.quoteRef);
  if (!quote) {
    throw new Error(`Quote ${input.quoteRef} not found.`);
  }
  if (quote.status === 'EXPIRED') {
    throw new Error(`Quote ${input.quoteRef} has expired.`);
  }

  const period = policyPeriod(new Date(), pricing.policyDays);
  const policyNo = makePolicyNo(input.rng);

  const policy = await db.create('insurancePolicy', {
    protectaRef: policyNo,
    policyNo,
    quoteRef: quote.reference,
    status: 'ACTIVE',
    premiumUgx: quote.premium,
    plate: quote.plate,
    vehicleMake: quote.vehicleMake ?? '',
    vehicleModel: quote.vehicleModel ?? '',
    periodStart: period.start,
    periodEnd: period.end,
    quoteId: quote.id,
  });

  await db.update('insuranceQuote', String(quote.id), { status: 'ACCEPTED' });
  if (input.paymentId) {
    await db.update('insurancePayment', input.paymentId, { policyId: policy.id });
  }

  let commission: RecordData | null = null;
  if (input.agentPersonId) {
    const premium = Number(quote.premium ?? 0);
    const rate =
      input.commissionRate ?? Number(process.env.COMMISSION_DEFAULT ?? 0.1);
    commission = await db.create('commission', {
      protectaRef: `CM-${policyNo}`,
      rate,
      amountUgx: Math.round(premium * rate),
      status: 'ACCRUED',
      statementMonth: statementMonth(),
      payoutRef: '',
      policyNo,
      policyId: policy.id,
      beneficiaryId: input.agentPersonId,
    });
  }

  return { policy, quote, commission };
};

export const findPolicyByNo = (db: DbClient, policyNo: string): Promise<RecordData | null> =>
  db.findFirst('insurancePolicies', { policyNo: { eq: policyNo } }, [
    'policyNo',
    'protectaRef',
    'quoteRef',
    'status',
    'premiumUgx',
    'plate',
    'vehicleMake',
    'vehicleModel',
    'periodStart',
    'periodEnd',
  ]);

export const findPoliciesByPhone = async (
  db: DbClient,
  phone: string,
): Promise<RecordData[]> => {
  const quotes = await db.findMany(
    'insuranceQuotes',
    { filter: { policyholderPhone: { eq: phone } }, first: 100 },
    ['reference'],
  );
  const refs = quotes.map((quote) => String(quote.reference));
  const policies: RecordData[] = [];
  for (const ref of refs) {
    const matches = await db.findMany(
      'insurancePolicies',
      { filter: { quoteRef: { eq: ref } }, first: 10 },
      ['policyNo', 'status', 'plate', 'premiumUgx', 'periodStart', 'periodEnd', 'quoteRef'],
    );
    policies.push(...matches);
  }
  return policies;
};

export const renewPolicy = async (
  db: DbClient,
  policyNo: string,
  options: { baseUrl?: string; rng?: () => number } = {},
): Promise<{ quote: RecordData; policy: RecordData }> => {
  const policy = await findPolicyByNo(db, policyNo);
  if (!policy) {
    throw new Error(`Policy ${policyNo} not found.`);
  }
  const quote = policy.quoteRef
    ? await findQuoteByRef(db, String(policy.quoteRef))
    : null;
  const reference = makeQuoteRef(options.rng);
  const baseUrl = options.baseUrl ?? process.env.PUBLIC_BASE_URL ?? '';
  const created = await db.create('insuranceQuote', {
    protectaRef: reference,
    reference,
    status: 'QUOTED',
    channel: 'PHONE',
    productCode: process.env.PRODUCT_CODE ?? 'BODE-01',
    plate: policy.plate,
    vehicleMake: policy.vehicleMake ?? '',
    vehicleModel: policy.vehicleModel ?? '',
    vehicleValue: quote?.vehicleValue ?? 0,
    premium: policy.premiumUgx,
    policyholderPhone: quote?.policyholderPhone ?? '',
    shareUrl: baseUrl ? quoteShareUrl(baseUrl, reference) : '',
    validUntil: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
  });
  return { quote: created, policy };
};
