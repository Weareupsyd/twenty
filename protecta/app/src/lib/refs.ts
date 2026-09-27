import { randomInt } from 'node:crypto';
const digits = (
  length: number,
  rng: () => number = () => randomInt(0, 10) / 10,
): string => {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += String(Math.floor(rng() * 10));
  }
  return out;
};

/** 15-digit zero-padded numeric quote reference (legacy-compatible). */
export const makeQuoteRef = (rng?: () => number): string => digits(15, rng);

export const makePolicyNo = (rng?: () => number): string =>
  `PB-${new Date().getUTCFullYear()}-${digits(6, rng)}`;

export const makeClaimRef = (rng?: () => number): string =>
  `CLM-${digits(8, rng)}`;

export const makeTicketRef = (rng?: () => number): string =>
  `TCK-${digits(6, rng)}`;

export const makePaymentRef = (rng?: () => number): string =>
  `PAY-${digits(10, rng)}`;

export const makeDeliveryId = (rng?: () => number): string =>
  `DLV-${Date.now().toString(36)}-${digits(6, rng)}`;

export const makeClientSecret = (rng?: () => number): string => {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = 'pb_';
  for (let i = 0; i < 32; i += 1) {
    out +=
      alphabet[
        rng
          ? Math.floor(rng() * alphabet.length)
          : randomInt(0, alphabet.length)
      ];
  }
  return out;
};
