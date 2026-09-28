import { type DbClient } from 'src/lib/records';

/**
 * Placeholder convention: `{{name}}` in a template body is replaced with
 * the matching value when the document is generated. When the real Word
 * policy template arrives, recreate its wording here (or upload it as the
 * template body) keeping the same placeholders - see README.md.
 */
export const PLACEHOLDERS: { key: string; description: string }[] = [
  { key: 'policyNo', description: 'Policy number, e.g. PB-2026-004213' },
  { key: 'reference', description: 'Generated document reference' },
  { key: 'status', description: 'Policy status' },
  { key: 'policyholderName', description: 'Policyholder full name' },
  { key: 'policyholderPhone', description: 'Policyholder phone' },
  { key: 'plate', description: 'Number plate' },
  { key: 'vehicle', description: 'Make and model' },
  { key: 'vehicleMake', description: 'Vehicle make' },
  { key: 'vehicleModel', description: 'Vehicle model' },
  { key: 'premium', description: 'Premium paid, formatted UGX' },
  { key: 'periodStart', description: 'Cover start date' },
  { key: 'periodEnd', description: 'Cover end date' },
  { key: 'quoteRef', description: 'Source quote reference' },
  { key: 'productName', description: 'Product line name' },
  { key: 'supportPhone', description: 'Support helpline' },
  { key: 'issuedDate', description: 'Date the document is generated' },
];

export const DEFAULT_POLICY_TEMPLATE = [
  'Protecta Bode',
  'Motor policy certificate',
  '',
  'Policy no: {{policyNo}}',
  'Status: {{status}}',
  'Policyholder: {{policyholderName}}',
  'Plate: {{plate}}',
  'Vehicle: {{vehicle}}',
  'Premium paid: {{premium}}',
  'Cover from: {{periodStart}}',
  'Cover until: {{periodEnd}}',
  'Product: {{productName}}',
  'Quote ref: {{quoteRef}}',
  '',
  'This document certifies that the motor policy referenced above is in force for the cover period stated.',
  '',
  'Keep this document as proof of cover. For claims, WhatsApp {{supportPhone}}.',
  '',
  'Generated {{issuedDate}} · Document ref {{reference}}',
].join('\n');

export type TemplateFormat = 'TEXT' | 'HTML';

export const DEFAULT_TEMPLATE_FORMAT: TemplateFormat = 'TEXT';

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
  const format: TemplateFormat =
    String(template?.format ?? '').toUpperCase() === 'HTML' ? 'HTML' : 'TEXT';
  return {
    body: body.length > 0 ? body : DEFAULT_POLICY_TEMPLATE,
    format: body.length > 0 ? format : DEFAULT_TEMPLATE_FORMAT,
  };
};
