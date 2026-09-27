export const PLURALS: Record<string, string> = {
  person: 'people',
  vehicle: 'vehicles',
  insuranceQuote: 'insuranceQuotes',
  insurancePolicy: 'insurancePolicies',
  insurancePayment: 'insurancePayments',
  insuranceClaim: 'insuranceClaims',
  commission: 'commissions',
  partnerAccount: 'partnerAccounts',
  supportTicket: 'supportTickets',
  kycCase: 'kycCases',
  webhookDelivery: 'webhookDeliveries',
  idempotencyRecord: 'idempotencyRecords',
  timelineActivity: 'timelineActivities',
};

export const pluralOf = (objectSingular: string): string =>
  PLURALS[objectSingular] ?? `${objectSingular}s`;
