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
  /** Schedule details for the policy document; kept on the vehicle record. */
  bodyType?: string;
  engineCc?: number;
  seatingCapacity?: number;
  channel?: QuoteChannel;
  productCode?: string;
  /** Contact details from the public forms; stored on the person record. */
  email?: string;
  nin?: string;
  consent?: boolean;
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
    ['protectaPhone', 'protectaRole', 'protectaNin', 'protectaConsent', 'emails', 'name'],
  );

export const personPrimaryEmail = (person: RecordData): string => {
  const emails = person.emails;
  if (typeof emails === 'string') return emails.trim();
  if (emails && typeof emails === 'object') {
    return String(
      (emails as { primaryEmail?: unknown }).primaryEmail ?? '',
    ).trim();
  }
  return '';
};

/**
 * Persist contact details collected on the public forms onto the person
 * record. Existing values are never overwritten — the details step only
 * fills what the record is missing (e.g. an email captured on the landing
 * page later becomes the policy delivery address).
 */
export const attachPersonContact = async (
  db: DbClient,
  person: RecordData,
  contact: { email?: string; nin?: string; consent?: boolean },
): Promise<RecordData> => {
  const patch: RecordData = {};
  const email = contact.email?.trim() ?? '';
  const nin = contact.nin?.trim() ?? '';
  if (email && !personPrimaryEmail(person)) {
    patch.emails = { primaryEmail: email };
  }
  if (nin && !String(person.protectaNin ?? '').trim()) {
    patch.protectaNin = nin;
  }
  if (contact.consent === true && person.protectaConsent !== true) {
    patch.protectaConsent = true;
  }
  if (Object.keys(patch).length === 0) return person;
  return db.update('person', String(person.id), patch);
};

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
    bodyType?: string;
    engineCc?: number;
    seatingCapacity?: number;
    ownerId?: string;
  },
): Promise<RecordData> => {
  const plate = normalizePlate(input.plate);
  const key = `${input.phone}:${plate}`;
  const schedule = {
    ...(input.bodyType ? { bodyType: input.bodyType } : {}),
    ...(typeof input.engineCc === 'number' ? { engineCc: input.engineCc } : {}),
    ...(typeof input.seatingCapacity === 'number'
      ? { seatingCapacity: input.seatingCapacity }
      : {}),
    ...(typeof input.value === 'number' ? { valueUgx: input.value } : {}),
    ...(input.model ? { model: input.model } : {}),
  };
  const existing = await db.findFirst(
    'vehicles',
    { protectaRef: { eq: key } },
    ['plate', 'protectaRef', 'valueUgx', 'bodyType', 'engineCc', 'seatingCapacity'],
  );
  if (existing) {
    // Fill in schedule details the record does not have yet, without
    // overwriting values an operator already corrected.
    const missing = Object.fromEntries(
      Object.entries(schedule).filter(
        ([field]) => existing[field] === null || existing[field] === undefined || existing[field] === '',
      ),
    );
    if (Object.keys(missing).length > 0) {
      return db.update('vehicle', String(existing.id), missing);
    }
    return existing;
  }
  return db.create('vehicle', {
    protectaRef: key,
    plate,
    make: input.make ?? '',
    model: input.model ?? '',
    ...(typeof input.year === 'number' ? { year: input.year } : {}),
    ...schedule,
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

  const { person: linkedPerson, isNew } = await ensurePerson(db, phone, input.name);
  const person = await attachPersonContact(db, linkedPerson, {
    email: input.email,
    nin: input.nin,
    consent: input.consent,
  });
  const vehicle = await ensureVehicle(db, {
    plate,
    phone,
    make: input.make,
    model: input.model,
    year: input.year,
    value: input.vehicleValue,
    bodyType: input.bodyType,
    engineCc: input.engineCc,
    seatingCapacity: input.seatingCapacity,
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
