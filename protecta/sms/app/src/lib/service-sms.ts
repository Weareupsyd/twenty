import { sendEgoSms, smsConfigFromEnv } from 'src/lib/egosms';
import { isValidMsisdn, msisdnForEgoSms } from 'src/lib/phones';
import { renderTemplate } from 'src/lib/render';
import { type DbClient, type RecordData } from 'src/lib/records';

export type SmsVariables = Record<string, string>;

/** Twenty SELECT option values must be UPPER_SNAKE_CASE. */
export const asSelectValue = (value: unknown): string =>
  String(value ?? '').trim().toUpperCase();

const digits = (
  length: number,
  rng: () => number = () => Math.random(),
): string => {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += String(Math.floor(rng() * 10));
  }
  return out;
};

/** SMS log reference shown in the CRM, e.g. SMS-004213. */
export const makeSmsRef = (rng?: () => number): string => `SMS-${digits(6, rng)}`;

/**
 * Template lookup with language fallback: exact language first, then the
 * configured default language, then any template for the event key.
 */
export const findSmsTemplate = async (
  db: DbClient,
  eventKey: string,
  language: string,
): Promise<{ body: string; language: string } | null> => {
  const select = ['eventKey', 'language', 'body'];
  const key = asSelectValue(eventKey);
  const lang = asSelectValue(language);
  const exact = await db.findFirst(
    'smsTemplates',
    { eventKey: { eq: key }, language: { eq: lang } },
    select,
  );
  if (exact && typeof exact.body === 'string' && exact.body.trim()) {
    return { body: exact.body, language: String(exact.language ?? lang) };
  }
  const fallbackLanguage = asSelectValue(
    smsConfigFromEnv()?.defaultLanguage ?? 'EN',
  );
  if (fallbackLanguage !== lang) {
    const fallback = await db.findFirst(
      'smsTemplates',
      { eventKey: { eq: key }, language: { eq: fallbackLanguage } },
      select,
    );
    if (fallback && typeof fallback.body === 'string' && fallback.body.trim()) {
      return {
        body: fallback.body,
        language: String(fallback.language ?? fallbackLanguage),
      };
    }
  }
  const any = await db.findFirst(
    'smsTemplates',
    { eventKey: { eq: key } },
    select,
  );
  if (any && typeof any.body === 'string' && any.body.trim()) {
    return { body: any.body, language: String(any.language ?? '') };
  }
  return null;
};

export type DeliverSmsInput = {
  recipient: string;
  eventKey?: string;
  language?: string;
  variables?: SmsVariables;
  /** Raw message override; when set no template is needed. */
  message?: string;
  makeRef?: () => string;
  maxRefAttempts?: number;
};

export type DeliverSmsOutcome = {
  record: RecordData | null;
  outcome: 'SENT' | 'FAILED' | 'SKIPPED';
  error?: string;
};

const parseVariables = (raw: unknown): SmsVariables => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([key, value]) => [
        key,
        String(value ?? ''),
      ]),
    );
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, String(value ?? '')]),
      );
    } catch {
      return {};
    }
  }
  return {};
};

/**
 * Resolve the final message text for an Sms record: a pre-filled message
 * wins, otherwise render the template for the record's event key.
 */
export const resolveSmsBody = async (
  db: DbClient,
  input: {
    message?: string;
    eventKey?: string;
    language?: string;
    variables?: SmsVariables;
  },
): Promise<
  | { ok: true; message: string; language: string }
  | { ok: false; error: string }
> => {
  const config = smsConfigFromEnv();
  const language = asSelectValue(
    input.language?.trim() || config?.defaultLanguage || 'EN',
  );
  const message = (input.message ?? '').trim();
  if (message) return { ok: true, message, language };
  const eventKey = asSelectValue(input.eventKey);
  if (!eventKey) {
    return { ok: false, error: 'eventKey or message is required.' };
  }
  const template = await findSmsTemplate(db, eventKey, language);
  if (!template) {
    return {
      ok: false,
      error: `No SMS template for ${eventKey} (${language}).`,
    };
  }
  return {
    ok: true,
    message: renderTemplate(template.body, input.variables ?? {}),
    language: template.language || language,
  };
};

const createWithReference = async (
  db: DbClient,
  data: RecordData,
  makeRef: () => string,
  maxAttempts: number,
): Promise<RecordData> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await db.create('smsMessage', { ...data, reference: makeRef() });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

/**
 * Render (or accept) a message and send it through EgoSMS, logging the
 * attempt as an Sms message record created WITH its message already
 * filled (so the created-event handler never re-sends it). Configuration
 * and template problems are skipped without creating noise; provider
 * failures are recorded.
 */
export const deliverSms = async (
  db: DbClient,
  input: DeliverSmsInput,
): Promise<DeliverSmsOutcome> => {
  const config = smsConfigFromEnv();
  if (!config) {
    return {
      record: null,
      outcome: 'SKIPPED',
      error: 'SMS provider is not configured.',
    };
  }

  const resolved = await resolveSmsBody(db, input);
  if (!resolved.ok) {
    return { record: null, outcome: 'SKIPPED', error: resolved.error };
  }

  const recipient = msisdnForEgoSms(input.recipient);
  if (!isValidMsisdn(recipient)) {
    return {
      record: null,
      outcome: 'SKIPPED',
      error: `Invalid recipient "${input.recipient}".`,
    };
  }

  // Cost guard and double-send protection: several triggers (auto event
  // handlers, app-to-app calls) can ask for the same notification; the
  // first send wins.
  const sent = await db.findMany(
    'smsMessages',
    {
      filter: {
        eventKey: { eq: asSelectValue(input.eventKey) },
        recipient: { eq: recipient },
        status: { eq: 'SENT' },
      },
      first: 50,
    },
    ['message'],
  );
  if (sent.some((row) => String(row.message ?? '') === resolved.message)) {
    return {
      record: null,
      outcome: 'SKIPPED',
      error: 'Duplicate send suppressed.',
    };
  }

  const record = await createWithReference(
    db,
    {
      eventKey: asSelectValue(input.eventKey),
      language: resolved.language,
      recipient,
      message: resolved.message,
      variables: JSON.stringify(input.variables ?? {}),
      status: 'PENDING',
      error: '',
      providerRef: '',
    },
    input.makeRef ?? (() => makeSmsRef()),
    input.maxRefAttempts ?? 3,
  );

  const result = await sendEgoSms(config, {
    number: recipient,
    message: resolved.message,
  });
  const updated = await db.update('smsMessage', String(record.id), {
    status: result.ok ? 'SENT' : 'FAILED',
    providerRef: result.providerRef,
    error: result.error,
    sentAt: new Date().toISOString(),
  });
  return {
    record: updated,
    outcome: result.ok ? 'SENT' : 'FAILED',
    error: result.error || undefined,
  };
};

/**
 * Complete a manually created Sms message record: fill its reference and
 * message from the event template, then send. Only records created
 * WITHOUT a message are processed — records created with a message are
 * sent by their creator, which is what prevents double sends.
 */
export const fillSmsMessage = async (
  db: DbClient,
  record: RecordData,
  options: { makeRef?: () => string; maxRefAttempts?: number } = {},
): Promise<RecordData> => {
  const hadMessage =
    typeof record.message === 'string' && record.message.trim().length > 0;
  const alreadySent = String(record.sentAt ?? '').trim().length > 0;
  if (hadMessage || alreadySent) return record;

  const config = smsConfigFromEnv();
  const variables = parseVariables(record.variables);
  const resolved = await resolveSmsBody(db, {
    eventKey: asSelectValue(record.eventKey),
    language: asSelectValue(record.language),
    variables,
  });
  if (!resolved.ok) {
    return db.update('smsMessage', String(record.id), {
      status: 'FAILED',
      error: resolved.error,
      sentAt: new Date().toISOString(),
    });
  }

  let reference = String(record.reference ?? '').trim();
  if (!reference) {
    const makeRef = options.makeRef ?? (() => makeSmsRef());
    const maxAttempts = options.maxRefAttempts ?? 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const candidate = makeRef();
        await db.update('smsMessage', String(record.id), { reference: candidate });
        reference = candidate;
        break;
      } catch {
        // unique reference collision; try again
      }
    }
    if (!reference) reference = makeRef();
  }

  const recipient = msisdnForEgoSms(String(record.recipient ?? ''));
  if (!isValidMsisdn(recipient)) {
    return db.update('smsMessage', String(record.id), {
      reference,
      language: resolved.language,
      message: resolved.message,
      status: 'FAILED',
      error: `Invalid recipient "${String(record.recipient ?? '')}".`,
      sentAt: new Date().toISOString(),
    });
  }

  if (!config) {
    return db.update('smsMessage', String(record.id), {
      reference,
      language: resolved.language,
      message: resolved.message,
      status: 'FAILED',
      error: 'SMS provider is not configured.',
      sentAt: new Date().toISOString(),
    });
  }

  const result = await sendEgoSms(config, {
    number: recipient,
    message: resolved.message,
  });
  return db.update('smsMessage', String(record.id), {
    reference,
    language: resolved.language,
    message: resolved.message,
    recipient,
    status: result.ok ? 'SENT' : 'FAILED',
    providerRef: result.providerRef,
    error: result.error,
    sentAt: new Date().toISOString(),
  });
};
