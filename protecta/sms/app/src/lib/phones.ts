/**
 * Normalize a phone number to the MSISDN form EgoSMS expects
 * (e.g. 256779644690): +256... and 07.../07... national formats are
 * accepted; other countries pass through as digits.
 */
export const msisdnForEgoSms = (phone: string): string => {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.startsWith('256')) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `256${digits.slice(1)}`;
  if (digits.length === 9) return `256${digits}`;
  return digits;
};

export const isValidMsisdn = (msisdn: string): boolean => msisdn.length >= 9;
