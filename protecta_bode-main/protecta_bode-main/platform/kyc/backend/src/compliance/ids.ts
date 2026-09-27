/** Deterministic display refs used in the combined console (SUB-90411, BUS-4412). */

export type RefKind = 'SUB' | 'BUS' | 'SCR' | 'RPT' | 'COV' | 'FNL' | 'HIT' | 'AUD';

export function shortRef(prefix: RefKind, id: string): string {
  const hex = String(id || '').replace(/-/g, '').toLowerCase();
  let n = 0;
  for (let i = 0; i < hex.length; i += 1) {
    n = (n * 33 + hex.charCodeAt(i)) >>> 0;
  }
  const width = prefix === 'BUS' || prefix === 'RPT' || prefix === 'COV' || prefix === 'FNL' || prefix === 'HIT' || prefix === 'AUD' ? 4 : 5;
  const mod = 10 ** width;
  return `${prefix}-${String(n % mod).padStart(width, '0')}`;
}

export function parseDisplayRef(value: string): { prefix: RefKind; digits: string } | null {
  const m = String(value || '').trim().toUpperCase().match(/^(SUB|BUS|SCR|RPT|COV|FNL|HIT|AUD)-([0-9A-Z]+)$/);
  if (!m) return null;
  return { prefix: m[1] as RefKind, digits: m[2] };
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
