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
    expect(result.quote.reference).toMatch(/^\d{6}$/);
    expect(result.quote.status).toBe('QUOTED');
    expect(result.quote.channel).toBe('WHATSAPP');
    expect(result.quote.shareUrl).toContain('https://crm.example.com/s/protecta/quotes/view');
    expect(result.isNewPerson).toBe(true);

    const found = await findQuoteByRef(db, String(result.quote.reference));
    expect(found?.premium).toBe(150_000);
  });

  it('keeps the schedule details on the vehicle record', async () => {
    const db = setup();
    const result = await createQuote(
      db,
      {
        phone: '0772000000',
        plate: 'UAX 123C',
        vehicleValue: 10_000_000,
        make: 'Toyota',
        model: 'Premio',
        bodyType: 'Saloon',
        engineCc: 1800,
        seatingCapacity: 5,
      },
      { pricing: DEFAULT_PRICING, rng: () => 0.3 },
    );
    expect(result.vehicle).toMatchObject({
      bodyType: 'Saloon',
      engineCc: 1800,
      seatingCapacity: 5,
    });

    // A later quote for the same plate fills in what is still missing but
    // leaves corrected values alone.
    const again = await createQuote(
      db,
      {
        phone: '0772000000',
        plate: 'UAX 123C',
        vehicleValue: 11_000_000,
        bodyType: 'Saloon',
        seatingCapacity: 7,
      },
      { pricing: DEFAULT_PRICING, rng: () => 0.4 },
    );
    expect(again.vehicle.seatingCapacity).toBe(5);
    expect(again.vehicle.engineCc).toBe(1800);
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

  it('stores email, ID number and consent on the person record', async () => {
    const db = setup();
    const result = await createQuote(
      db,
      {
        phone: '0772000000',
        name: 'Jane Doe',
        plate: 'UAX 123C',
        vehicleValue: 10_000_000,
        email: 'jane@example.com',
        nin: 'CM90123456TYCQ',
        consent: true,
      },
      { pricing: DEFAULT_PRICING },
    );
    expect(result.person.emails).toEqual({ primaryEmail: 'jane@example.com' });
    expect(result.person.protectaNin).toBe('CM90123456TYCQ');
    expect(result.person.protectaConsent).toBe(true);
  });

  it('fills missing contact details on a known person but never overwrites them', async () => {
    const db = setup();
    // First quote comes without contact details (e.g. the WhatsApp bot).
    const first = await createQuote(
      db,
      { phone: '0772000000', plate: 'UAX 1A', vehicleValue: 5_000_000 },
      { pricing: DEFAULT_PRICING },
    );
    expect(first.person.emails).toBeUndefined();

    // The landing page later collects them — the gaps are filled.
    const second = await createQuote(
      db,
      {
        phone: '0772000000',
        plate: 'UAX 1A',
        vehicleValue: 5_000_000,
        email: 'jane@example.com',
        nin: 'CM90123456TYCQ',
        consent: true,
      },
      { pricing: DEFAULT_PRICING },
    );
    expect(second.person.emails).toEqual({ primaryEmail: 'jane@example.com' });
    expect(second.person.protectaNin).toBe('CM90123456TYCQ');
    expect(second.person.protectaConsent).toBe(true);

    // A repeat quote with different details never overwrites the stored ones.
    const third = await createQuote(
      db,
      {
        phone: '0772000000',
        plate: 'UAX 2B',
        vehicleValue: 6_000_000,
        email: 'other@example.com',
        nin: 'OTHER-ID-123',
      },
      { pricing: DEFAULT_PRICING },
    );
    expect(third.person.emails).toEqual({ primaryEmail: 'jane@example.com' });
    expect(third.person.protectaNin).toBe('CM90123456TYCQ');
  });
});
