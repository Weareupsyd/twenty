import { afterEach, describe, expect, it, vi } from 'vitest';
import { requirePartnerApiKey } from 'src/lib/auth-partner';
import { MemoryDbClient } from 'src/lib/records';
import {
  registerPartner,
  listEventsForPartner,
  authenticatePartner,
} from 'src/lib/service-partners';

afterEach(() => vi.unstubAllEnvs());
describe('partner API', () => {
  it('provisions a hashed secret and returns only safe partner fields', async () => {
    const db = new MemoryDbClient();
    const { partner, apiKey } = await registerPartner(db, {
      name: 'Test broker',
      type: 'BROKER',
    });
    const [clientId, secret] = apiKey.split('.');
    expect(partner).not.toHaveProperty('clientSecretHash');
    expect(db.store.partnerAccounts[0].clientSecretHash).not.toEqual(secret);
    expect(JSON.stringify(db.store)).not.toContain(secret);
    expect((await requirePartnerApiKey(db, { 'X-API-Key': apiKey })).ok).toBe(
      true,
    );
    expect(
      (await requirePartnerApiKey(db, { 'x-api-key': `${clientId}.bad` })).ok,
    ).toBe(false);
    expect((await requirePartnerApiKey(db, {})).ok).toBe(false);
    await db.update('partnerAccount', String(partner.id), { isActive: false });
    expect((await requirePartnerApiKey(db, { 'x-api-key': apiKey })).ok).toBe(
      false,
    );
  });
  it('validates registration inputs and commission bounds', async () => {
    const db = new MemoryDbClient();
    for (const input of [
      { name: '', type: 'AGENT' },
      { name: 'Broker', type: 'ADMIN' },
      { name: 'Broker', type: 'AGENT', commissionRate: 2 },
    ]) {
      await expect(registerPartner(db, input)).rejects.toThrow();
    }
    expect(db.store.partnerAccounts).toBeUndefined();
  });
  it('scopes event queries to the authenticated partner and checks reports permission', async () => {
    const db = new MemoryDbClient();
    const { partner } = await registerPartner(db, {
      name: 'Broker',
      type: 'BROKER',
    });
    const current = db.store.partnerAccounts[0];
    await db.create('webhookDelivery', {
      partnerId: partner.id,
      event: 'quote.created',
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    await db.create('webhookDelivery', {
      partnerId: 'another-partner',
      event: 'quote.created',
      createdAt: '2026-09-02T00:00:00.000Z',
    });
    await db.create('webhookDelivery', {
      partnerId: partner.id,
      event: 'policy.issued',
      createdAt: '2026-09-03T00:00:00.000Z',
    });
    const rows = await listEventsForPartner(db, current, {
      type: 'quote.created',
      before: '2026-09-02T00:00:00Z',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].partnerId).toBe(partner.id);
    await expect(
      listEventsForPartner(db, { ...current, scopes: [] }),
    ).rejects.toThrow('scope');
    await expect(
      listEventsForPartner(db, current, { limit: NaN }),
    ).rejects.toThrow('limit');
  });
  it('restricts token scopes by the current account and rejects revoked accounts', async () => {
    vi.stubEnv('PARTNER_JWT_SECRET', 'test-signing-secret');
    const db = new MemoryDbClient();
    const { apiKey, partner } = await registerPartner(db, {
      name: 'Broker',
      type: 'BROKER',
    });
    const [clientId, clientSecret] = apiKey.split('.');
    const { token } = await authenticatePartner(db, {
      clientId,
      clientSecret,
      jwtSecret: 'test-signing-secret',
    });
    await db.update('partnerAccount', String(partner.id), {
      scopes: ['policies:read'],
    });
    const auth = await requirePartnerApiKey(db, {
      authorization: `Bearer ${token}`,
    });
    expect(auth.ok && auth.partner.scopes).toEqual(['policies:read']);
    await db.update('partnerAccount', String(partner.id), { isActive: false });
    expect(
      (await requirePartnerApiKey(db, { authorization: `Bearer ${token}` })).ok,
    ).toBe(false);
  });
});
