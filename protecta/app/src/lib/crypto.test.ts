import { describe, expect, it } from 'vitest';
import { hmacSha256Hex, sha256Hex, signJwtHs256, verifyJwtHs256 } from 'src/lib/crypto';

describe('hashing', () => {
  it('hashes deterministically', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('abc')).toHaveLength(64);
    expect(hmacSha256Hex('k', 'm')).toHaveLength(64);
  });
});

describe('jwt', () => {
  it('round-trips claims', () => {
    const token = signJwtHs256({ sub: 'partner-1' }, 'secret', 3600, 1_000_000);
    const claims = verifyJwtHs256<{ sub: string }>(token, 'secret', 1_000_100);
    expect(claims?.sub).toBe('partner-1');
  });

  it('rejects wrong secrets, tampering and expiry', () => {
    const token = signJwtHs256({ sub: 'x' }, 'secret', 60, 1_000_000);
    expect(verifyJwtHs256(token, 'other', 1_000_010)).toBeNull();
    expect(verifyJwtHs256(`${token}tampered`, 'secret', 1_000_010)).toBeNull();
    expect(verifyJwtHs256(token, 'secret', 2_000_000)).toBeNull();
    expect(verifyJwtHs256('not-a-token', 'secret')).toBeNull();
  });
});
