import { type DbClient } from 'src/lib/records';
import {
  POLICY_TEMPLATE_BODY,
  POLICY_TEMPLATE_NAME,
} from 'src/lib/policy-template';
import { POLICY_TEMPLATE_HTML } from 'src/lib/policy-template-html';

/**
 * Placeholder convention: `{{name}}` in a template body is replaced with
 * the matching value when the document is generated. The values are read
 * from the Protecta records (policy, quote, vehicle, policyholder) at
 * generation time - see render.ts.
 *
 * Unknown placeholders are left visible on purpose: a typo in a template
 * shows up instead of silently printing a blank.
 */
export const PLACEHOLDERS: { key: string; description: string }[] = [
  { key: 'policyNo', description: 'Policy number, e.g. PB-2026-004213' },
  { key: 'reference', description: 'Generated document reference (DOC-XXXXXX)' },
  { key: 'status', description: 'Policy status, e.g. ACTIVE' },
  { key: 'policyholderName', description: 'Policyholder full name' },
  { key: 'policyholderPhone', description: 'Policyholder phone (from the quote)' },
  { key: 'insuredAddress', description: 'Policyholder address' },
  {
    key: 'businessProfession',
    description: 'Policyholder business or profession',
  },
  { key: 'plate', description: 'Number plate' },
  { key: 'vehicle', description: 'Make and model, e.g. Toyota Premio' },
  { key: 'vehicleMake', description: 'Vehicle make' },
  { key: 'vehicleModel', description: 'Vehicle model' },
  { key: 'vehicleYear', description: 'Year of manufacture' },
  { key: 'bodyType', description: 'Vehicle body type (BODY)' },
  { key: 'engineCc', description: 'Engine capacity in c.c.' },
  { key: 'seatingCapacity', description: 'Seating capacity' },
  { key: 'sumInsured', description: 'Agreed limit of cover / sum insured, UGX' },
  { key: 'premium', description: 'Premium paid, formatted UGX' },
  { key: 'trainingLevy', description: 'Training levy, formatted UGX' },
  { key: 'stickerFees', description: 'Sticker fees, formatted UGX' },
  { key: 'vat', description: 'VAT, formatted UGX' },
  { key: 'stampDuty', description: 'Stamp duty (S/Duty), formatted UGX' },
  {
    key: 'totalPremium',
    description: 'Total premium due, formatted UGX (recorded total, else the sum of the recorded lines)',
  },
  { key: 'premiumAmount', description: 'Premium amount without the UGX prefix for the original schedule column' },
  { key: 'trainingLevyAmount', description: 'Training levy amount without the UGX prefix for the original schedule column' },
  { key: 'stickerFeesAmount', description: 'Sticker fee amount without the UGX prefix for the original schedule column' },
  { key: 'vatAmount', description: 'VAT amount without the UGX prefix for the original schedule column' },
  { key: 'stampDutyAmount', description: 'Stamp duty amount without the UGX prefix for the original schedule column' },
  { key: 'totalPremiumAmount', description: 'Total premium without the UGX prefix for the original schedule column' },
  { key: 'periodStart', description: 'Cover start date' },
  { key: 'periodEnd', description: 'Cover end date' },
  { key: 'proposalDate', description: 'Date the proposal/quote was signed' },
  { key: 'issuedDate', description: 'Date the document is generated' },
  { key: 'quoteRef', description: 'Source quote reference' },
  { key: 'productName', description: 'Product line name' },
  { key: 'supportPhone', description: 'Support helpline' },
];

export const DEFAULT_POLICY_TEMPLATE = POLICY_TEMPLATE_BODY;
export const DEFAULT_POLICY_TEMPLATE_HTML = POLICY_TEMPLATE_HTML;

export const DEFAULT_POLICY_TEMPLATE_NAME = POLICY_TEMPLATE_NAME;

export type TemplateFormat = 'TEXT' | 'HTML';

export const DEFAULT_TEMPLATE_FORMAT: TemplateFormat = 'HTML';

export const findTemplate = async (
  db: DbClient,
  kind: string,
): Promise<{ body: string; format: TemplateFormat }> => {
  const template = await db.findFirst(
    'documentTemplates',
    { kind: { eq: kind } },
    ['name', 'kind', 'format', 'body'],
  );
  const body = typeof template?.body === 'string' ? template.body.trim() : '';
  const isLegacyBuiltIn =
    kind === 'POLICY_CERTIFICATE' && body === POLICY_TEMPLATE_BODY;

  // Upgrade the previously installed built-in text transcription in-place at
  // read time; custom workspace templates remain untouched.
  if (isLegacyBuiltIn || body.length === 0) {
    return { body: POLICY_TEMPLATE_HTML, format: DEFAULT_TEMPLATE_FORMAT };
  }

  const format: TemplateFormat =
    String(template?.format ?? '').toUpperCase() === 'HTML' ? 'HTML' : 'TEXT';
  return { body, format };
};
