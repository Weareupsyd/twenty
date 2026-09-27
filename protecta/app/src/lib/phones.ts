/** Normalize a Ugandan MSISDN to E.164 (+256XXXXXXXXX). Returns null when invalid. */
export const normalizeUgPhone = (raw: string | null | undefined): string | null => {
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
  if (value.startsWith('0')) {
    value = `256${value.slice(1)}`;
  }
  if (!/^256\d{9}$/.test(value)) {
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
