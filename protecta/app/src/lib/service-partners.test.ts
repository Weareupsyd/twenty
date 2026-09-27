import { describe, expect, it } from 'vitest';
import { MemoryDbClient } from 'src/lib/records';
import {
  authenticatePartner,
  hashClientSecret,
  saveIdempotencyRecord,
  findIdempotencyRecord,
  verifyPartnerToken,
} from 'src/lib/service-partners';

const seedPartner = async (db: MemoryDbClient) =>
  db.create('partnerAccount', {
    clientId: 'acme-brokers',
    clientSecretHash: hashClientSecret('s3cret'),
    environment: 'SANDBOX',
    commissionRate: 0.12,
    isActive: true,
    webhookUrl: '',
    scopes: ['quotes:write'],
  });

describe('partner auth', () => {
  it('issues and verifies tokens', async () => {
    const db = new MemoryDbClient();
    await seedPartner(db);
    const { token, scopes } = await authenticatePartner(db, {
      clientId: 'acme-brokers',
      clientSecret: 's3cret',
      jwtSecret: 'jwt-secret',
    });
    expect(scopes).toEqual(['quotes:write']);
    const claims = verifyPartnerToken(token, 'jwt-secret');
    expect(claims?.clientId).toBe('acme-brokers');
    expect(verifyPartnerToken(token, 'wrong')).toBeNull();
  });

  it('rejects bad credentials', async () => {
    const db = new MemoryDbClient();
    await seedPartner(db);
    await expect(
      authenticatePartner(db, { clientId: 'acme-brokers', clientSecret: 'nope', jwtSecret: 'x' }),
    ).rejects.toThrow('Invalid');
  });

  it('round-trips idempotency records', async () => {
    const db = new MemoryDbClient();
    const partner = await seedPartner(db);
    await saveIdempotencyRecord(db, {
      partnerId: String(partner.id),
      key: 'abc',
      operation: 'quotes.create',
      requestHash: 'hash',
      response: { ok: true },
    });
    const found = await findIdempotencyRecord(db, String(partner.id), 'abc');
    expect(found?.operation).toBe('quotes.create');
  });
});
