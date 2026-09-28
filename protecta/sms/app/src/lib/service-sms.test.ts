import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDbClient } from 'src/lib/records';
import {
  asSelectValue,
  deliverSms,
  fillSmsMessage,
  findSmsTemplate,
  makeSmsRef,
} from 'src/lib/service-sms';

const ENV_KEYS = ['EGOSMS_USERNAME', 'EGOSMS_PASSWORD', 'EGOSMS_SENDER_ID', 'SMS_DEFAULT_LANGUAGE'];

const configure = () => {
  process.env.EGOSMS_USERNAME = 'user';
  process.env.EGOSMS_PASSWORD = 'secret';
};

const stubFetchOk = (payload: Record<string, unknown> = {}) => {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ Status: 'OK', MsgFollowUpUniqueCode: 'REF1', ...payload }),
        { status: 200 },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('makeSmsRef', () => {
  it('formats SMS-XXXXXX with one draw per digit', () => {
    const draws = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    let next = 0;
    expect(makeSmsRef(() => draws[next++ % draws.length])).toBe('SMS-123456');
    expect(makeSmsRef()).toMatch(/^SMS-\d{6}$/);
  });
});

describe('asSelectValue', () => {
  it('normalizes SELECT values to UPPER_SNAKE_CASE', () => {
    expect(asSelectValue('quote_issued')).toBe('QUOTE_ISSUED');
    expect(asSelectValue(' lg ')).toBe('LG');
    expect(asSelectValue(undefined)).toBe('');
  });
});

describe('findSmsTemplate', () => {
  it('prefers the exact language, then the default, then any', async () => {
    const db = new MemoryDbClient();
    await db.create('smsTemplate', {
      name: 'English',
      eventKey: 'QUOTE_ISSUED',
      language: 'EN',
      body: 'Quote {{reference}}',
    });
    await db.create('smsTemplate', {
      name: 'Luganda',
      eventKey: 'QUOTE_ISSUED',
      language: 'LG',
      body: 'Quote {{reference}} lg',
    });
    expect(await findSmsTemplate(db, 'quote_issued', 'lg')).toEqual({
      body: 'Quote {{reference}} lg',
      language: 'LG',
    });
    configure();
    // 'sw' falls back to the configured default language 'EN'
    expect(await findSmsTemplate(db, 'quote_issued', 'sw')).toEqual({
      body: 'Quote {{reference}}',
      language: 'EN',
    });
    expect(await findSmsTemplate(db, 'policy_issued', 'en')).toBeNull();
  });
});

describe('deliverSms', () => {
  it('skips without creating noise when unconfigured', async () => {
    const db = new MemoryDbClient();
    const outcome = await deliverSms(db, {
      recipient: '0779644690',
      eventKey: 'QUOTE_ISSUED',
    });
    expect(outcome.outcome).toBe('SKIPPED');
    expect(outcome.record).toBeNull();
    expect(await db.findFirst('smsMessages', {}, ['id'])).toBeNull();
  });

  it('skips when no template exists for the event', async () => {
    configure();
    const db = new MemoryDbClient();
    const outcome = await deliverSms(db, {
      recipient: '0779644690',
      eventKey: 'QUOTE_ISSUED',
    });
    expect(outcome.outcome).toBe('SKIPPED');
    expect(outcome.error).toContain('No SMS template');
  });

  it('creates the record with the message filled and sends it', async () => {
    configure();
    const db = new MemoryDbClient();
    await db.create('smsTemplate', {
      name: 'Quote en',
      eventKey: 'QUOTE_ISSUED',
      language: 'EN',
      body: 'Quote {{reference}} costs {{premium}}',
    });
    const fetchMock = stubFetchOk();
    const outcome = await deliverSms(db, {
      recipient: '+256 779 644 690',
      eventKey: 'quote_issued',
      variables: { reference: '123', premium: '150,000' },
      makeRef: () => 'SMS-000001',
    });
    expect(outcome.outcome).toBe('SENT');
    expect(outcome.record?.reference).toBe('SMS-000001');
    expect(outcome.record?.message).toBe('Quote 123 costs 150,000');
    expect(outcome.record?.recipient).toBe('256779644690');
    expect(outcome.record?.status).toBe('SENT');
    expect(outcome.record?.eventKey).toBe('QUOTE_ISSUED');
    expect(outcome.record?.language).toBe('EN');
    expect(outcome.record?.providerRef).toBe('REF1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The created-event handler must not re-send message-filled records.
    const again = await fillSmsMessage(db, outcome.record!);
    expect(again).toBe(outcome.record);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('suppresses duplicate sends of the same message to the same recipient', async () => {
    configure();
    const db = new MemoryDbClient();
    await db.create('smsTemplate', {
      name: 'Policy en',
      eventKey: 'POLICY_ISSUED',
      language: 'EN',
      body: 'Policy {{policyNo}} is active',
    });
    stubFetchOk();
    const first = await deliverSms(db, {
      recipient: '0779644690',
      eventKey: 'POLICY_ISSUED',
      variables: { policyNo: 'PB-1' },
      makeRef: () => 'SMS-000011',
    });
    expect(first.outcome).toBe('SENT');
    const second = await deliverSms(db, {
      recipient: '+256779644690',
      eventKey: 'POLICY_ISSUED',
      variables: { policyNo: 'PB-1' },
      makeRef: () => 'SMS-000012',
    });
    expect(second.outcome).toBe('SKIPPED');
    expect(second.error).toContain('Duplicate');
    expect(second.record).toBeNull();
    // A different message to the same recipient still goes out.
    const third = await deliverSms(db, {
      recipient: '0779644690',
      eventKey: 'POLICY_ISSUED',
      variables: { policyNo: 'PB-2' },
      makeRef: () => 'SMS-000013',
    });
    expect(third.outcome).toBe('SENT');
  });

  it('records provider failures', async () => {
    configure();
    const db = new MemoryDbClient();
    await db.create('smsTemplate', {
      name: 'Quote en',
      eventKey: 'QUOTE_ISSUED',
      language: 'EN',
      body: 'Hi',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ Status: 'Failed', Message: 'No balance' }), {
            status: 200,
          }),
      ),
    );
    const outcome = await deliverSms(db, {
      recipient: '0779644690',
      eventKey: 'QUOTE_ISSUED',
      makeRef: () => 'SMS-000002',
    });
    expect(outcome.outcome).toBe('FAILED');
    expect(outcome.record?.status).toBe('FAILED');
    expect(outcome.record?.error).toBe('No balance');
    expect(outcome.record?.sentAt).toBeTruthy();
  });
});

describe('fillSmsMessage', () => {
  it('sends manually created records created without a message', async () => {
    configure();
    const db = new MemoryDbClient();
    await db.create('smsTemplate', {
      name: 'Policy lg',
      eventKey: 'POLICY_ISSUED',
      language: 'LG',
      body: 'Policy {{policyNo}}',
    });
    const manual = await db.create('smsMessage', {
      reference: '',
      eventKey: 'POLICY_ISSUED',
      language: 'LG',
      recipient: '0772000000',
      message: '',
      variables: JSON.stringify({ policyNo: 'PB-1' }),
      status: 'PENDING',
    });
    stubFetchOk();
    const filled = await fillSmsMessage(db, manual, {
      makeRef: () => 'SMS-000003',
    });
    expect(filled.reference).toBe('SMS-000003');
    expect(filled.message).toBe('Policy PB-1');
    expect(filled.status).toBe('SENT');
    expect(filled.recipient).toBe('256772000000');
    expect(filled.language).toBe('LG');
    expect(filled.sentAt).toBeTruthy();
  });

  it('marks records failed when the template is missing', async () => {
    configure();
    const db = new MemoryDbClient();
    const manual = await db.create('smsMessage', {
      reference: 'SMS-000004',
      eventKey: 'CLAIM_CREATED',
      recipient: '0772000000',
      message: '',
      status: 'PENDING',
    });
    const filled = await fillSmsMessage(db, manual);
    expect(filled.status).toBe('FAILED');
    expect(String(filled.error)).toContain('No SMS template');
    expect(filled.sentAt).toBeTruthy();
  });

  it('never touches records that already carry a message', async () => {
    const db = new MemoryDbClient();
    const record = await db.create('smsMessage', {
      reference: 'SMS-000005',
      eventKey: 'CUSTOM',
      recipient: '0772000000',
      message: 'Raw text',
      status: 'PENDING',
    });
    const fetchMock = stubFetchOk();
    const result = await fillSmsMessage(db, record);
    expect(result).toBe(record);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
