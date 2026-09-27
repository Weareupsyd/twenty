export type PricingConfig = {
  rate: number;
  minValue: number;
  maxValue: number;
  policyDays: number;
  quoteValidityDays?: number;
};

export const DEFAULT_PRICING: PricingConfig = {
  rate: 0.015,
  minValue: 1_000_000,
  maxValue: 300_000_000,
  policyDays: 365,
  quoteValidityDays: 15,
};

export const pricingFromEnv = (env: NodeJS.ProcessEnv = process.env): PricingConfig => ({
  rate: Number(env.PRODUCT_RATE ?? DEFAULT_PRICING.rate),
  minValue: Number(env.MIN_VEHICLE_VALUE ?? DEFAULT_PRICING.minValue),
  maxValue: Number(env.MAX_VEHICLE_VALUE ?? DEFAULT_PRICING.maxValue),
  policyDays: Number(env.POLICY_DAYS ?? DEFAULT_PRICING.policyDays),
  quoteValidityDays: DEFAULT_PRICING.quoteValidityDays,
});

/** Yearly premium, rounded to whole shillings. */
export const computePremium = (vehicleValue: number, rate: number): number =>
  Math.round(vehicleValue * rate);

export const validateVehicleValue = (
  vehicleValue: number,
  config: PricingConfig,
): string | null => {
  if (!Number.isFinite(vehicleValue)) {
    return 'Vehicle value must be a number.';
  }
  if (vehicleValue < config.minValue) {
    return `Vehicle value must be at least UGX ${config.minValue.toLocaleString('en-US')}.`;
  }
  if (vehicleValue > config.maxValue) {
    return `Vehicle value must be at most UGX ${config.maxValue.toLocaleString('en-US')}.`;
  }
  return null;
};

export const quoteValidUntil = (
  from: Date = new Date(),
  validityDays = DEFAULT_PRICING.quoteValidityDays ?? 15,
): string => {
  const end = new Date(from);
  end.setUTCDate(end.getUTCDate() + validityDays);
  return end.toISOString().slice(0, 10);
};

export const policyPeriod = (
  from: Date = new Date(),
  policyDays = DEFAULT_PRICING.policyDays,
): { start: string; end: string } => {
  const start = new Date(from);
  const end = new Date(from);
  end.setUTCDate(end.getUTCDate() + policyDays);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
};

export const isQuoteExpired = (validUntil: string | null, now = new Date()): boolean => {
  if (!validUntil) {
    return false;
  }
  return validUntil < now.toISOString().slice(0, 10);
};
