export const PARTNER_SCOPE_VALUES = {
  'customers:write': 'CUSTOMERS_WRITE',
  'quotes:write': 'QUOTES_WRITE',
  'policies:read': 'POLICIES_READ',
  'payments:write': 'PAYMENTS_WRITE',
  'claims:write': 'CLAIMS_WRITE',
  'reports:read': 'REPORTS_READ',
} as const;

export type PartnerScope = keyof typeof PARTNER_SCOPE_VALUES;

export const PARTNER_SCOPES = Object.keys(
  PARTNER_SCOPE_VALUES,
) as PartnerScope[];

const PARTNER_SCOPE_BY_METADATA_VALUE = new Map<string, PartnerScope>(
  Object.entries(PARTNER_SCOPE_VALUES).map(([scope, metadataValue]) => [
    metadataValue,
    scope as PartnerScope,
  ]),
);

/** Convert metadata enum values into the stable, public API scope strings. */
export const normalizePartnerScopes = (
  scopes: readonly string[] | string | null | undefined,
): PartnerScope[] => {
  if (!scopes) return [];

  const values = Array.isArray(scopes) ? scopes : [scopes];
  return [
    ...new Set(
      values.flatMap((value) => {
        if (PARTNER_SCOPES.includes(value as PartnerScope)) {
          return [value as PartnerScope];
        }

        const normalized = PARTNER_SCOPE_BY_METADATA_VALUE.get(value);
        return normalized ? [normalized] : [];
      }),
    ),
  ];
};

export const toStoredPartnerScopes = (
  scopes: readonly PartnerScope[],
): string[] => scopes.map((scope) => PARTNER_SCOPE_VALUES[scope]);

export const hasScope = (
  scopes: readonly string[] | string | null | undefined,
  required: PartnerScope,
): boolean => normalizePartnerScopes(scopes).includes(required);

export const ROUTE_SCOPES: Record<string, PartnerScope> = {
  customersCreate: 'customers:write',
  customersGet: 'policies:read',
  quoteCreate: 'quotes:write',
  quoteBind: 'quotes:write',
  paymentGet: 'payments:write',
  claimCreate: 'claims:write',
  commissions: 'reports:read',
};
