export const PARTNER_SCOPES = [
  'customers:write',
  'quotes:write',
  'policies:read',
  'payments:write',
  'claims:write',
  'reports:read',
] as const;

export type PartnerScope = (typeof PARTNER_SCOPES)[number];

export const hasScope = (
  scopes: readonly string[] | string | null | undefined,
  required: PartnerScope,
): boolean => {
  if (!scopes) {
    return false;
  }
  const list = Array.isArray(scopes) ? scopes : [scopes];
  return list.includes(required);
};

export const ROUTE_SCOPES: Record<string, PartnerScope> = {
  customersCreate: 'customers:write',
  customersGet: 'policies:read',
  quoteCreate: 'quotes:write',
  quoteBind: 'quotes:write',
  paymentGet: 'payments:write',
  claimCreate: 'claims:write',
  commissions: 'reports:read',
};
