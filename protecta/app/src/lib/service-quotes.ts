import { normalizePlate, normalizeUgPhone } from 'src/lib/phones';
import {
  computePremium,
  pricingFromEnv,
  quoteValidUntil,
  validateVehicleValue,
  type PricingConfig,
} from 'src/lib/pricing';
import { makeQuoteRef } from 'src/lib/refs';
import { type DbClient, type RecordData } from 'src/lib/records';

export type QuoteChannel = 'PORTAL' | 'WHATSAPP' | 'PARTNER_API' | 'PHONE';

export type CreateQuoteInput = {
  phone: string;
  name?: string;
  plate: string;
  vehicleValue: number;
  make?: string;
  model?: string;
  year?: number;
  channel?: QuoteChannel;
  productCode?: string;
};

export type CreatedQuote = {
  quote: RecordData;
  person: RecordData;
  vehicle: RecordData;
  premium: number;
  isNewPerson: boolean;
};

export const splitName = (
  fullName: string,
): { firstName: string; lastName: string } => {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: 'Protecta', lastName: 'Customer' };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
};

export const findPersonByPhone = (
  db: DbClient,
  phone: string,
): Promise<RecordData | null> =>
  db.findFirst(
    'people',
    { protectaPhone: { eq: phone } },
    ['protectaPhone', 'protectaRole', 'name'],
  );

export const personDisplayName = (person: RecordData): string => {
  const name = person.name;
  if (typeof name === 'string') return name.trim();
  if (name && typeof name === 'object') {
    const parts = name as { firstName?: unknown; lastName?: unknown };
    return [
      String(parts.firstName ?? '').trim(),
      String(parts.lastName ?? '').trim(),
    ]
      .filter(Boolean)
      .join(' ');
  }
  return '';
};

export const ensurePerson = async (
  db: DbClient,
  phone: string,
  name?: string,
  role = 'CUSTOMER',
): Promise<{ person: RecordData; isNew: boolean }> => {
  const existing = await findPersonByPhone(db, phone);
  if (existing) {
    return { person: existing, isNew: false };
  }
  const person = await db.create('person', {
    name: splitName(name ?? ''),
    protectaPhone: phone,
    protectaRole: role,
    protectaKycStatus: 'PENDING',
  });
  return { person, isNew: true };
};

export const ensureVehicle = async (
  db: DbClient,
  input: {
    plate: string;
    phone: string;
    make?: string;
    model?: string;
    year?: number;
    value?: number;
    ownerId?: string;
  },
): Promise<RecordData> => {
  const plate = normalizePlate(input.plate);
  const key = `${input.phone}:${plate}`;
  const existing = await db.findFirst(
    'vehicles',
    { protectaRef: { eq: key } },
    ['plate', 'protectaRef'],
  );
  if (existing) {
    return existing;
  }
  return db.create('vehicle', {
    protectaRef: key,
    plate,
    make: input.make ?? '',
    model: input.model ?? '',
    ...(typeof input.year === 'number' ? { year: input.year } : {}),
    ...(typeof input.value === 'number' ? { valueUgx: input.value } : {}),
    ownerPhone: input.phone,
    ...(input.ownerId ? { ownerId: input.ownerId } : {}),
  });
};

export const quoteShareUrl = (baseUrl: string, quoteRef: string): string => {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/s/protecta/quotes/view?ref=${encodeURIComponent(quoteRef)}`;
};

export const createQuote = async (
  db: DbClient,
  input: CreateQuoteInput,
  options: {
    pricing?: PricingConfig;
    baseUrl?: string;
    productCode?: string;
    rng?: () => number;
  } = {},
): Promise<CreatedQuote> => {
  const pricing = options.pricing ?? pricingFromEnv();
  const phone = normalizeUgPhone(input.phone);
  if (!phone) {
    throw new Error('A valid Ugandan phone number is required.');
  }
  const valueError = validateVehicleValue(input.vehicleValue, pricing);
  if (valueError) {
    throw new Error(valueError);
  }
  const plate = normalizePlate(input.plate);
  if (!plate) {
    throw new Error('A number plate is required.');
  }

  const premium = computePremium(input.vehicleValue, pricing.rate);
  const reference = makeQuoteRef(options.rng);
  const baseUrl = options.baseUrl ?? process.env.PUBLIC_BASE_URL ?? '';

  const { person, isNew } = await ensurePerson(db, phone, input.name);
  const vehicle = await ensureVehicle(db, {
    plate,
    phone,
    make: input.make,
    model: input.model,
    year: input.year,
    value: input.vehicleValue,
    ownerId: person.id as string | undefined,
  });

  const quote = await db.create('insuranceQuote', {
    protectaRef: reference,
    reference,
    status: 'QUOTED',
    channel: input.channel ?? 'PORTAL',
    productCode:
      input.productCode ??
      options.productCode ??
      process.env.PRODUCT_CODE ??
      'BODE-01',
    plate,
    vehicleMake: input.make ?? '',
    vehicleModel: input.model ?? '',
    vehicleValue: input.vehicleValue,
    premium,
    policyholderPhone: phone,
    shareUrl: baseUrl ? quoteShareUrl(baseUrl, reference) : '',
    validUntil: quoteValidUntil(),
    policyholderId: person.id,
  });

  void vehicle;
  return { quote, person, vehicle, premium, isNewPerson: isNew };
};

export const findQuoteByRef = (
  db: DbClient,
  reference: string,
): Promise<RecordData | null> =>
  db.findFirst('insuranceQuotes', { reference: { eq: reference } }, [
    'reference',
    'protectaRef',
    'status',
    'channel',
    'plate',
    'vehicleMake',
    'vehicleModel',
    'vehicleValue',
    'premium',
    'policyholderPhone',
    'policyholderId',
    'shareUrl',
    'validUntil',
  ]);

export const markQuoteAccepted = async (
  db: DbClient,
  quote: RecordData,
): Promise<RecordData> =>
  db.update('insuranceQuote', String(quote.id), { status: 'ACCEPTED' });

export const markQuoteExpired = async (
  db: DbClient,
  quote: RecordData,
): Promise<RecordData> =>
  db.update('insuranceQuote', String(quote.id), { status: 'EXPIRED' });
