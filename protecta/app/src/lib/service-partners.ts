import { randomBytes } from 'node:crypto';
import {
  normalizePartnerScopes,
  PARTNER_SCOPES,
  toStoredPartnerScopes,
} from 'src/lib/partner-scopes';
import {
  sha256Hex,
  signaturesEqual,
  signJwtHs256,
  verifyJwtHs256,
} from 'src/lib/crypto';
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

export const findPartnerByClientId = async (
  db: DbClient,
  clientId: string,
): Promise<RecordData | null> => {
  const partner = await db.findFirst(
    'partnerAccounts',
    { clientId: { eq: clientId } },
    [
      'name',
      'partnerType',
      'clientId',
      'clientSecretHash',
      'environment',
      'commissionRate',
      'isActive',
      'webhookUrl',
      'scopes',
    ],
  );

  return partner
    ? { ...partner, scopes: normalizePartnerScopes(partner.scopes as string[]) }
    : null;
};

export const authenticatePartner = async (
  db: DbClient,
  input: { clientId: string; clientSecret: string; jwtSecret: string },
): Promise<{ token: string; partner: RecordData; scopes: string[] }> => {
  const partner = await findPartnerByClientId(db, input.clientId);
  if (!partner || partner.isActive !== true) {
    throw new Error('Invalid client credentials.');
  }
  if (
    !signaturesEqual(
      sha256Hex(input.clientSecret),
      String(partner.clientSecretHash ?? ''),
    )
  ) {
    throw new Error('Invalid client credentials.');
  }
  const scopes = Array.isArray(partner.scopes)
    ? (partner.scopes as string[])
    : [];
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
  const claims = verifyJwtHs256<PartnerTokenClaims & { exp?: number }>(
    token,
    jwtSecret,
  );
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

export const requireScope = (
  claims: PartnerTokenClaims,
  scope: PartnerScope,
): void => {
  if (!hasScope(claims.scopes, scope)) {
    throw new Error(`Missing required scope: ${scope}.`);
  }
};

export const bearerToken = (
  authorization: string | null | undefined,
): string | null => {
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

/** Provisioned by an authenticated Twenty staff/API-key request only. */
export const registerPartner = async (
  db: DbClient,
  input: {
    type: string;
    name: string;
    email?: string;
    phone?: string;
    companyId?: string;
    commissionRate?: number;
  },
): Promise<{ partner: RecordData; apiKey: string }> => {
  const name = input.name.trim();
  const type = input.type.toUpperCase();
  if (name.length < 2 || name.length > 200)
    throw new Error('A partner name (2-200 characters) is required.');
  if (!['AGENT', 'BROKER', 'INTEGRATOR'].includes(type))
    throw new Error('Invalid partner type.');
  const rate = input.commissionRate ?? 0.1;
  if (!Number.isFinite(rate) || rate < 0 || rate > 1)
    throw new Error('Commission rate must be between 0 and 1.');
  const clientId = `pb_${randomBytes(12).toString('hex')}`;
  const secret = randomBytes(32).toString('base64url');
  const saved = await db.create('partnerAccount', {
    protectaRef: clientId,
    clientId,
    clientSecretHash: hashClientSecret(secret),
    name,
    partnerType: type,
    contactEmail: input.email?.trim() ?? '',
    contactPhone: input.phone?.trim() ?? '',
    companyReference: input.companyId?.trim() ?? '',
    commissionRate: rate,
    environment: 'SANDBOX',
    isActive: true,
    webhookUrl: '',
    scopes: toStoredPartnerScopes(PARTNER_SCOPES),
  });
  return { partner: publicPartner(saved), apiKey: `${clientId}.${secret}` };
};

export const publicPartner = (partner: RecordData): RecordData => ({
  id: partner.id,
  code: partner.clientId,
  clientId: partner.clientId,
  name: partner.name,
  type: partner.partnerType ?? partner.type,
  status: partner.isActive === true ? 'ACTIVE' : 'INACTIVE',
  environment: partner.environment,
  scopes: normalizePartnerScopes(partner.scopes as string[]),
});

export const listEventsForPartner = async (
  db: DbClient,
  partner: RecordData,
  options: { type?: string; limit?: number; before?: string } = {},
): Promise<RecordData[]> => {
  if (!partner.id || partner.isActive !== true)
    throw new Error('Invalid partner.');
  if (!hasScope(partner.scopes as string[], 'reports:read'))
    throw new Error('Missing required scope: reports:read.');
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('limit must be between 1 and 100.');
  if (options.before && !Number.isFinite(Date.parse(options.before)))
    throw new Error('Invalid before timestamp.');
  const deliveries = await db.findMany(
    'webhookDeliveries',
    {
      filter: {
        and: [
          { partnerId: { eq: String(partner.id) } },
          ...(options.type ? [{ eventType: { eq: options.type } }] : []),
          ...(options.before
            ? [{ createdAt: { lt: new Date(options.before).toISOString() } }]
            : []),
        ],
      },
      first: limit,
      orderBy: [{ createdAt: 'DescNullsLast' }],
    },
    ['deliveryId', 'eventType', 'status', 'attempts', 'createdAt'],
  );

  // Keep the public event log's established `event` key independent of the
  // reserved metadata field name used by Twenty's GraphQL schema.
  return deliveries.map(({ eventType, ...delivery }) => ({
    ...delivery,
    event: eventType,
  }));
};
