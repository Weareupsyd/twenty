import { type DbClient } from 'src/lib/records';

export type DocumentData = Record<string, string>;

const formatUgx = (amount: number): string =>
  `UGX ${Math.round(amount).toLocaleString('en-US')}`;

const personName = (person: Record<string, unknown> | null): string => {
  const name = person?.name;
  if (typeof name === 'string') return name.trim();
  if (name && typeof name === 'object') {
    const parts = name as { firstName?: unknown; lastName?: unknown };
    return [
      String(parts.firstName ?? '').trim(),
      String(parts.lastName ?? '').trim(),
    ]
      .filter(Boolean)
      .join(' ');
  }
  return '';
};

/**
 * Collect the values every template can reference for a policy, reading
 * the Protecta records (policies, quotes, people) in the shared workspace.
 */
export const assembleDocumentData = async (
  db: DbClient,
  args: { policyNo: string; reference: string },
): Promise<{ data: DocumentData | null; error: string | null }> => {
  const policy = await db.findFirst(
    'insurancePolicies',
    { policyNo: { eq: args.policyNo } },
    [
      'policyNo',
      'status',
      'plate',
      'vehicleMake',
      'vehicleModel',
      'premiumUgx',
      'periodStart',
      'periodEnd',
      'quoteRef',
    ],
  );
  if (!policy) {
    return {
      data: null,
      error: `No policy with number ${args.policyNo}.`,
    };
  }
  const quoteRef = String(policy.quoteRef ?? '');
  const quote = quoteRef
    ? await db.findFirst(
        'insuranceQuotes',
        { reference: { eq: quoteRef } },
        ['reference', 'policyholderId', 'policyholderPhone'],
      )
    : null;
  const person = quote?.policyholderId
    ? await db.findFirst(
        'people',
        { id: { eq: String(quote.policyholderId) } },
        ['name'],
      )
    : null;

  const vehicle = [String(policy.vehicleMake ?? ''), String(policy.vehicleModel ?? '')]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');

  const data: DocumentData = {
    policyNo: String(policy.policyNo ?? args.policyNo),
    reference: args.reference,
    status: String(policy.status ?? ''),
    policyholderName: personName(person),
    policyholderPhone: String(quote?.policyholderPhone ?? ''),
    plate: String(policy.plate ?? ''),
    vehicle,
    vehicleMake: String(policy.vehicleMake ?? ''),
    vehicleModel: String(policy.vehicleModel ?? ''),
    premium: formatUgx(Number(policy.premiumUgx ?? 0)),
    periodStart: String(policy.periodStart ?? ''),
    periodEnd: String(policy.periodEnd ?? ''),
    quoteRef,
    productName: process.env.PRODUCT_NAME ?? 'Protecta Bode motor insurance',
    supportPhone: process.env.SUPPORT_PHONE ?? '+256312246500',
    issuedDate: new Date().toISOString().slice(0, 10),
  };
  return { data, error: null };
};

/** Replace `{{key}}` placeholders; unknown keys are left visible. */
export const renderTemplate = (body: string, data: DocumentData): string =>
  body.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key: string) =>
    key in data ? (data[key] || '—') : match,
  );
