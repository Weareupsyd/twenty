import { type DbClient } from 'src/lib/records';

export type DocumentData = Record<string, string>;

const formatUgx = (amount: number): string =>
  `UGX ${Math.round(amount).toLocaleString('en-US')}`;

/** Long dates in the wording, ISO dates in the tables. */
const isoDate = (value: unknown): string => {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
};

const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Money as the schedule prints it; an unrecorded value stays empty ("—"). */
const moneyOrEmpty = (value: number | null): string =>
  value === null ? '' : formatUgx(value);

const moneyWithoutCurrency = (value: number | null): string =>
  value === null ? '—' : Math.round(value).toLocaleString('en-US');

/** Configuration an operator sets once per deployment (app settings). */
export type ScheduleConfig = {
  trainingLevyRate: number | null;
  vatRate: number | null;
  stickerFeesUgx: number | null;
  stampDutyUgx: number | null;
};

/** A rate or amount of 0 (or unset) means "not configured": show "—". */
const configured = (value: unknown): number | null => {
  const parsed = numberOrNull(value);
  return parsed === null || parsed === 0 ? null : parsed;
};

export const scheduleConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): ScheduleConfig => ({
  trainingLevyRate: configured(env.POLICY_TRAINING_LEVY_RATE),
  vatRate: configured(env.POLICY_VAT_RATE),
  stickerFeesUgx: configured(env.POLICY_STICKER_FEES_UGX),
  stampDutyUgx: configured(env.POLICY_STAMP_DUTY_UGX),
});

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

const text = (value: unknown): string => String(value ?? '').trim();

type PolicyRow = Record<string, unknown>;
type QuoteRow = Record<string, unknown> | null;

/**
 * Premium breakdown for the schedule.
 *
 * Per-policy values win; a deployment-wide rate/amount (app settings) is
 * the fallback; anything still unknown stays empty so the document shows
 * "—" instead of an invented shilling amount. The total is the recorded
 * total when there is one, otherwise the sum of the lines that are known.
 */
export const premiumBreakdown = (
  policy: PolicyRow,
  config: ScheduleConfig = scheduleConfigFromEnv(),
): {
  premium: number | null;
  trainingLevy: number | null;
  stickerFees: number | null;
  vat: number | null;
  stampDuty: number | null;
  total: number | null;
} => {
  const premium = numberOrNull(policy.premiumUgx);

  const trainingLevy =
    numberOrNull(policy.trainingLevyUgx) ??
    (premium !== null && config.trainingLevyRate !== null
      ? Math.round(premium * config.trainingLevyRate)
      : null);

  const vat =
    numberOrNull(policy.vatUgx) ??
    (premium !== null && config.vatRate !== null
      ? Math.round(premium * config.vatRate)
      : null);

  const stickerFees =
    numberOrNull(policy.stickerFeesUgx) ?? config.stickerFeesUgx;
  const stampDuty = numberOrNull(policy.stampDutyUgx) ?? config.stampDutyUgx;

  const recordedTotal = numberOrNull(policy.totalPremiumUgx);
  const lines = [premium, trainingLevy, stickerFees, vat, stampDuty];
  const total =
    recordedTotal ??
    (premium === null
      ? null
      : lines.reduce<number>((sum, line) => sum + (line ?? 0), 0));

  return { premium, trainingLevy, stickerFees, vat, stampDuty, total };
};

/**
 * Collect the values every template can reference for a policy, reading
 * the Protecta records (policies, quotes, people, vehicles) in the
 * shared workspace.
 */
export const assembleDocumentData = async (
  db: DbClient,
  args: { policyNo: string; reference: string; config?: ScheduleConfig },
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
      'bodyType',
      'engineCc',
      'seatingCapacity',
      'sumInsuredUgx',
      'trainingLevyUgx',
      'stickerFeesUgx',
      'vatUgx',
      'stampDutyUgx',
      'totalPremiumUgx',
    ],
  );
  if (!policy) {
    return {
      data: null,
      error: `No policy with number ${args.policyNo}.`,
    };
  }
  const quoteRef = String(policy.quoteRef ?? '');
  const quote: QuoteRow = quoteRef
    ? await db.findFirst(
        'insuranceQuotes',
        { reference: { eq: quoteRef } },
        [
          'reference',
          'policyholderId',
          'policyholderPhone',
          'vehicleValue',
          'createdAt',
        ],
      )
    : null;
  const person = quote?.policyholderId
    ? await db.findFirst(
        'people',
        { id: { eq: String(quote.policyholderId) } },
        ['name', 'protectaPhone', 'protectaAddress', 'protectaOccupation'],
      )
    : null;

  // The vehicle record (by plate) fills in anything the quote did not
  // capture, so a policy issued from an older quote still prints in full.
  const plate = text(policy.plate) || text(quote?.plate);
  const vehicle = plate
    ? await db.findFirst(
        'vehicles',
        { plate: { eq: plate } },
        ['plate', 'make', 'model', 'year', 'valueUgx', 'bodyType', 'engineCc', 'seatingCapacity'],
      )
    : null;

  const makeAndModel = [
    text(policy.vehicleMake) || text(vehicle?.make),
    text(policy.vehicleModel) || text(vehicle?.model),
  ]
    .filter(Boolean)
    .join(' ');

  const breakdown = premiumBreakdown(policy, args.config);
  // The supplied policy HTML specifies these fixed schedule charges. Recorded
  // per-policy values or deployment settings override the source defaults.
  const htmlStickerFees = breakdown.stickerFees ?? 6_000;
  const htmlStampDuty = breakdown.stampDuty ?? 35_000;
  const htmlTotalPremium =
    numberOrNull(policy.totalPremiumUgx) ??
    (breakdown.premium === null
      ? null
      : breakdown.premium +
        (breakdown.trainingLevy ?? 0) +
        htmlStickerFees +
        (breakdown.vat ?? 0) +
        htmlStampDuty);

  const data: DocumentData = {
    policyNo: String(policy.policyNo ?? args.policyNo),
    reference: args.reference,
    status: String(policy.status ?? ''),
    policyholderName: personName(person),
    policyholderPhone:
      text(quote?.policyholderPhone) || text(person?.protectaPhone),
    insuredAddress: text(person?.protectaAddress),
    businessProfession: text(person?.protectaOccupation),
    plate,
    vehicle: makeAndModel,
    vehicleMake: text(policy.vehicleMake) || text(vehicle?.make),
    vehicleModel: text(policy.vehicleModel) || text(vehicle?.model),
    vehicleYear: text(vehicle?.year),
    bodyType: text(policy.bodyType) || text(vehicle?.bodyType),
    engineCc: text(policy.engineCc) || text(vehicle?.engineCc),
    seatingCapacity:
      text(policy.seatingCapacity) || text(vehicle?.seatingCapacity),
    sumInsured: moneyOrEmpty(
      numberOrNull(policy.sumInsuredUgx) ??
        numberOrNull(quote?.vehicleValue) ??
        numberOrNull(vehicle?.valueUgx),
    ),
    premium: moneyOrEmpty(breakdown.premium),
    trainingLevy: moneyOrEmpty(breakdown.trainingLevy),
    stickerFees: moneyOrEmpty(breakdown.stickerFees),
    vat: moneyOrEmpty(breakdown.vat),
    stampDuty: moneyOrEmpty(breakdown.stampDuty),
    totalPremium: moneyOrEmpty(breakdown.total),
    premiumAmount: moneyWithoutCurrency(breakdown.premium),
    trainingLevyAmount: moneyWithoutCurrency(breakdown.trainingLevy),
    stickerFeesAmount: moneyWithoutCurrency(htmlStickerFees),
    vatAmount: moneyWithoutCurrency(breakdown.vat),
    stampDutyAmount: moneyWithoutCurrency(htmlStampDuty),
    totalPremiumAmount: moneyWithoutCurrency(htmlTotalPremium),
    periodStart: isoDate(policy.periodStart),
    periodEnd: isoDate(policy.periodEnd),
    proposalDate: isoDate(quote?.createdAt) || isoDate(policy.periodStart),
    quoteRef,
    productName: process.env.PRODUCT_NAME ?? 'Protecta Bode motor insurance',
    supportPhone: process.env.SUPPORT_PHONE ?? '+256312246500',
    issuedDate: new Date().toISOString().slice(0, 10),
  };
  return { data, error: null };
};

const escapeHtmlValue = (value: string): string =>
  value.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
      char
    ] ?? char,
  );

/** Replace `{{key}}` placeholders; unknown keys are left visible. */
export const renderTemplate = (
  body: string,
  data: DocumentData,
  options: { escapeHtmlValues?: boolean } = {},
): string =>
  body.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key: string) => {
    if (!(key in data)) return match;
    const value = data[key] || '—';
    return options.escapeHtmlValues ? escapeHtmlValue(value) : value;
  });
