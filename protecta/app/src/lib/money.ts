export const formatUgx = (amount: number | string | null | undefined): string => {
  const value = typeof amount === 'string' ? Number(amount) : (amount ?? 0);
  if (!Number.isFinite(value)) {
    return 'UGX 0';
  }
  return `UGX ${Math.round(value).toLocaleString('en-US')}`;
};
