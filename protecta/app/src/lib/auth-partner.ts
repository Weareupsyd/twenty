import { sha256Hex, signaturesEqual } from 'src/lib/crypto';
import { type DbClient, type RecordData } from 'src/lib/records';
import {
  bearerToken,
  findPartnerByClientId,
  verifyPartnerToken,
} from 'src/lib/service-partners';

export const headerValue = (
  headers: Record<string, string | undefined> | undefined,
  name: string,
): string =>
  Object.entries(headers ?? {}).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1] ?? '';

export const requirePartnerApiKey = async (
  db: DbClient,
  headers: Record<string, string | undefined>,
): Promise<{ ok: true; partner: RecordData } | { ok: false }> => {
  const key = headerValue(headers, 'x-api-key');
  if (key) {
    const parts = key.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false };
    const partner = await findPartnerByClientId(db, parts[0]);
    if (
      !partner ||
      partner.isActive !== true ||
      !signaturesEqual(
        sha256Hex(parts[1]),
        String(partner.clientSecretHash ?? ''),
      )
    )
      return { ok: false };
    return { ok: true, partner };
  }
  const token = bearerToken(headerValue(headers, 'authorization'));
  const secret = process.env.PARTNER_JWT_SECRET;
  if (!token || !secret) return { ok: false };
  const claims = verifyPartnerToken(token, secret);
  if (!claims) return { ok: false };
  const partner = await findPartnerByClientId(db, claims.clientId);
  if (!partner || partner.isActive !== true || partner.id !== claims.partnerId)
    return { ok: false };
  const current = Array.isArray(partner.scopes) ? partner.scopes : [];
  return {
    ok: true,
    partner: {
      ...partner,
      scopes: current.filter((scope) => claims.scopes.includes(String(scope))),
    },
  };
};
