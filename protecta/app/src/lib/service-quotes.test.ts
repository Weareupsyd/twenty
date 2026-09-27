import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICING } from 'src/lib/pricing';
import { MemoryDbClient } from 'src/lib/records';
import { createQuote, findQuoteByRef } from 'src/lib/service-quotes';

const setup = () => new MemoryDbClient();

describe('createQuote', () => {
  it('creates person, vehicle and quote with 1.5% premium', async () => {
    const db = setup();
    const result = await createQuote(
      db,
      {
        phone: '0772000000',
        name: 'Jane Doe',
        plate: 'UAX 123C',
        vehicleValue: 10_000_000,
        channel: 'WHATSAPP',
      },
      { pricing: DEFAULT_PRICING, baseUrl: 'https://crm.example.com', rng: () => 0.1 },
    );

    expect(result.premium).toBe(150_000);
    expect(result.quote.reference).toMatch(/^\d{15}$/);
    expect(result.quote.status).toBe('QUOTED');
    expect(result.quote.channel).toBe('WHATSAPP');
    expect(result.quote.shareUrl).toContain('https://crm.example.com/s/protecta/quotes/view');
    expect(result.isNewPerson).toBe(true);

    const found = await findQuoteByRef(db, String(result.quote.reference));
    expect(found?.premium).toBe(150_000);
  });

  it('reuses the existing person on repeat quotes', async () => {
    const db = setup();
    const first = await createQuote(
      db,
      { phone: '+256772000000', plate: 'UAX 1A', vehicleValue: 5_000_000 },
      { pricing: DEFAULT_PRICING, rng: () => 0.2 },
    );
    const second = await createQuote(
      db,
      { phone: '0772000000', plate: 'UAX 2B', vehicleValue: 6_000_000 },
      { pricing: DEFAULT_PRICING, rng: () => 0.3 },
    );
    expect(first.isNewPerson).toBe(true);
    expect(second.isNewPerson).toBe(false);
    expect(first.person.id).toBe(second.person.id);
  });

  it('rejects bad phones and out-of-band values', async () => {
    const db = setup();
    await expect(
      createQuote(db, { phone: '123', plate: 'UAX 1A', vehicleValue: 5_000_000 }, { pricing: DEFAULT_PRICING }),
    ).rejects.toThrow('phone');
    await expect(
      createQuote(db, { phone: '0772000000', plate: 'UAX 1A', vehicleValue: 500 }, { pricing: DEFAULT_PRICING }),
    ).rejects.toThrow('at least');
  });
});
