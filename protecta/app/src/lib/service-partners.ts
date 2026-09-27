import { sha256Hex, signJwtHs256, verifyJwtHs256 } from 'src/lib/crypto';
import { hasScope, type PartnerScope } from 'src/lib/partner-scopes';
import { type DbClient, type RecordData } from 'src/lib/records';

export const PARTNER_TOKEN_TTL_SECONDS = 60 * 60;

export type PartnerTokenClaims = {
  clientId: string;
  partnerId: string;
  scopes: string[];
  environment: string;
};

export const hashClientSecret = (secret: string): string => sha256Hex(secret);

export const findPartnerByClientId = (
  db: DbClient,
  clientId: string,
): Promise<RecordData | null> =>
  db.findFirst('partnerAccounts', { clientId: { eq: clientId } }, [
    'clientId',
    'clientSecretHash',
    'environment',
    'commissionRate',
    'isActive',
    'webhookUrl',
    'scopes',
  ]);

export const authenticatePartner = async (
  db: DbClient,
  input: { clientId: string; clientSecret: string; jwtSecret: string },
): Promise<{ token: string; partner: RecordData; scopes: string[] }> => {
  const partner = await findPartnerByClientId(db, input.clientId);
  if (!partner || partner.isActive === false) {
    throw new Error('Invalid client credentials.');
  }
  if (sha256Hex(input.clientSecret) !== String(partner.clientSecretHash ?? '')) {
    throw new Error('Invalid client credentials.');
  }
  const scopes = Array.isArray(partner.scopes) ? (partner.scopes as string[]) : [];
  const token = signJwtHs256(
    {
      clientId: String(partner.clientId),
      partnerId: String(partner.id),
      scopes,
      environment: String(partner.environment ?? 'SANDBOX'),
    },
    input.jwtSecret,
    PARTNER_TOKEN_TTL_SECONDS,
  );
  return { token, partner, scopes };
};

export const verifyPartnerToken = (
  token: string,
  jwtSecret: string,
): PartnerTokenClaims | null => {
  const claims = verifyJwtHs256<PartnerTokenClaims & { exp?: number }>(token, jwtSecret);
  if (!claims || !claims.clientId || !claims.partnerId) {
    return null;
  }
  return {
    clientId: String(claims.clientId),
    partnerId: String(claims.partnerId),
    scopes: Array.isArray(claims.scopes) ? claims.scopes.map(String) : [],
    environment: String(claims.environment ?? 'SANDBOX'),
  };
};

export const requireScope = (claims: PartnerTokenClaims, scope: PartnerScope): void => {
  if (!hasScope(claims.scopes, scope)) {
    throw new Error(`Missing required scope: ${scope}.`);
  }
};

export const bearerToken = (authorization: string | null | undefined): string | null => {
  if (!authorization) {
    return null;
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
};

export const idempotencyKeyFor = (partnerId: string, key: string): string =>
  `${partnerId}:${key}`;

export const findIdempotencyRecord = (
  db: DbClient,
  partnerId: string,
  key: string,
): Promise<RecordData | null> =>
  db.findFirst(
    'idempotencyRecords',
    { idemKey: { eq: idempotencyKeyFor(partnerId, key) } },
    ['idemKey', 'operation', 'requestHash', 'response'],
  );

export const saveIdempotencyRecord = async (
  db: DbClient,
  input: {
    partnerId: string;
    key: string;
    operation: string;
    requestHash: string;
    response: Record<string, unknown>;
  },
): Promise<RecordData> =>
  db.create('idempotencyRecord', {
    idemKey: idempotencyKeyFor(input.partnerId, input.key),
    operation: input.operation,
    requestHash: input.requestHash,
    response: input.response,
    partnerId: input.partnerId,
  });
