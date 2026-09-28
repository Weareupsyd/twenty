/**
 * Normalize a Ugandan number to E.164 (+256XXXXXXXXX).
 * Accepts the formats customers actually type:
 * 0701440613, 701440613, 256701440613, +256 701 440 613, 00256701440613.
 */
export const normalizeUgPhone = (
  raw: string | null | undefined,
): string | null => {
  if (!raw) {
    return null;
  }
  let value = raw.trim().replace(/[\s\-().]/g, '');
  if (value.startsWith('+')) {
    value = value.slice(1);
  }
  if (value.startsWith('00')) {
    value = value.slice(2);
  }
  // Country code plus the trunk 0: 2560701440613.
  if (/^2560\d{9}$/.test(value)) {
    value = `256${value.slice(4)}`;
  }
  // National number without the trunk 0: 701440613. This is what the website
  // sends after stripping the +256 prefix shown beside the field.
  if (/^[2-9]\d{8}$/.test(value)) {
    value = `256${value}`;
  }
  if (/^0\d{9}$/.test(value)) {
    value = `256${value.slice(1)}`;
  }
  if (!/^256[2-9]\d{8}$/.test(value)) {
    return null;
  }
  return `+${value}`;
};

export const isE164 = (raw: string | null | undefined): boolean =>
  !!raw && /^\+\d{10,15}$/.test(raw.trim());

/** Normalize a Ugandan plate: uppercase, single spaces, e.g. "UAX 123C". */
export const normalizePlate = (raw: string | null | undefined): string => {
  if (!raw) {
    return '';
  }
  return raw.trim().toUpperCase().replace(/\s+/g, ' ');
};

export const isValidPlate = (raw: string | null | undefined): boolean => {
  const plate = normalizePlate(raw);
  return plate.length >= 5 && plate.length <= 12 && /^[A-Z0-9 ]+$/.test(plate);
};
