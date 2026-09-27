import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

export const hmacSha256Hex = (secret: string, value: string): string =>
  createHmac('sha256', secret).update(value, 'utf8').digest('hex');

export const signaturesEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
};

const base64UrlEncode = (value: string): string =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const base64UrlDecode = (value: string): string => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  return Buffer.from(`${padded}${'='.repeat(padLength)}`, 'base64').toString(
    'utf8',
  );
};

export type JwtClaims = Record<string, unknown> & {
  exp?: number;
  iat?: number;
};

export const signJwtHs256 = (
  claims: JwtClaims,
  secret: string,
  expiresInSeconds: number,
  issuedAtSeconds: number = Math.floor(Date.now() / 1000),
): string => {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(
    JSON.stringify({
      ...claims,
      iat: issuedAtSeconds,
      exp: issuedAtSeconds + expiresInSeconds,
    }),
  );
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`, 'utf8')
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${header}.${body}.${signature}`;
};

export const verifyJwtHs256 = <T extends JwtClaims = JwtClaims>(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): T | null => {
  if (!secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [header, body, signature] = parts;
  const expected = createHmac('sha256', secret)
    .update(`${header}.${body}`, 'utf8')
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  if (!signaturesEqual(signature, expected)) {
    return null;
  }
  try {
    const metadata = JSON.parse(base64UrlDecode(header));
    if (metadata?.alg !== 'HS256' || metadata?.typ !== 'JWT') return null;
    const claims = JSON.parse(base64UrlDecode(body)) as T;
    if (
      !claims ||
      typeof claims !== 'object' ||
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp)
    )
      return null;
    if (typeof claims.exp === 'number' && claims.exp <= nowSeconds) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
};
