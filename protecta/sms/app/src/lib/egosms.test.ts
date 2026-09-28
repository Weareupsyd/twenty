import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendEgoSms, smsConfigFromEnv } from 'src/lib/egosms';

const ENV_KEYS = ['EGOSMS_USERNAME', 'EGOSMS_PASSWORD', 'EGOSMS_SENDER_ID', 'SMS_DEFAULT_LANGUAGE'];

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('smsConfigFromEnv', () => {
  it('is null until username and password are configured', () => {
    expect(smsConfigFromEnv({})).toBeNull();
    expect(smsConfigFromEnv({ EGOSMS_USERNAME: 'u' })).toBeNull();
    const config = smsConfigFromEnv({
      EGOSMS_USERNAME: 'u',
      EGOSMS_PASSWORD: 'p',
    });
    expect(config).not.toBeNull();
    expect(config?.senderId).toBe('Upsyd');
    expect(config?.defaultLanguage).toBe('en');
  });

  it('honours sender id and default language overrides', () => {
    const config = smsConfigFromEnv({
      EGOSMS_USERNAME: 'u',
      EGOSMS_PASSWORD: 'p',
      EGOSMS_SENDER_ID: 'Protecta',
      SMS_DEFAULT_LANGUAGE: 'LG',
    });
    expect(config?.senderId).toBe('Protecta');
    expect(config?.defaultLanguage).toBe('lg');
  });
});

describe('sendEgoSms', () => {
  const config = {
    username: 'u',
    password: 'p',
    senderId: 'Upsyd',
    defaultLanguage: 'en',
  };

  it('posts the EgoSMS JSON payload and reads the follow-up code', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ Status: 'OK', Cost: '50', MsgFollowUpUniqueCode: 'ABC123' }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendEgoSms(config, {
      number: '256779644690',
      message: 'Hello',
    });
    expect(result.ok).toBe(true);
    expect(result.providerRef).toBe('ABC123');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://www.egosms.co/api/v1/json/');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      method: 'SendSms',
      userdata: { username: 'u', password: 'p' },
      msgdata: [{ number: '256779644690', message: 'Hello', senderid: 'Upsyd' }],
    });
  });

  it('reports provider failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ Status: 'Failed', Message: 'Insufficient balance' }), {
            status: 200,
          }),
      ),
    );
    const result = await sendEgoSms(config, { number: '256779644690', message: 'Hello' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Insufficient balance');
    expect(result.providerRef).toBe('');
  });
});
