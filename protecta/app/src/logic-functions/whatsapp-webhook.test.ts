import { afterEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ enqueue: vi.fn(async () => ({})) }));
vi.mock('twenty-sdk/logic-function', async (original) => ({
  ...(await original<typeof import('twenty-sdk/logic-function')>()),
  enqueueJobs: mocked.enqueue,
}));
import { handler } from 'src/logic-functions/whatsapp-webhook.logic-function';
import { handler as verifyHandler } from 'src/logic-functions/whatsapp-verify.logic-function';
import { hmacSha256Hex } from 'src/lib/crypto';
import { routeEvent } from 'src/test-utils/route-event';
const secret = 'test-meta-secret';
const rawBody = JSON.stringify({
  entry: [
    {
      changes: [
        {
          value: {
            messages: [
              {
                from: '256772000000',
                id: 'message-1',
                type: 'text',
                text: { body: 'Hi' },
              },
            ],
          },
        },
      ],
    },
  ],
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe('WhatsApp webhook', () => {
  it('fails closed if verification is unconfigured, unsigned, or raw bytes are missing', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', '');
    expect((await handler(routeEvent({ rawBody }))).status).toBe(503);
    vi.stubEnv('WHATSAPP_APP_SECRET', secret);
    expect((await handler(routeEvent({ rawBody }))).status).toBe(401);
    expect(
      (await handler(routeEvent({ body: JSON.parse(rawBody) }))).status,
    ).toBe(401);
    expect(mocked.enqueue).not.toHaveBeenCalled();
  });
  it('verifies raw-body HMAC and enqueues deterministic message IDs', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', secret);
    const event = routeEvent({
      rawBody,
      headers: {
        'X-Hub-Signature-256': `sha256=${hmacSha256Hex(secret, rawBody)}`,
      },
    });
    expect((await handler(event)).status).toBe(200);
    await handler(event);
    expect(mocked.enqueue.mock.calls[0]).toEqual(mocked.enqueue.mock.calls[1]);
    expect((await handler({ ...event, rawBody: rawBody + ' ' })).status).toBe(
      401,
    );
  });
  it('accepts a signed Evolution API message and rejects a missing key', async () => {
    vi.stubEnv('EVOLUTION_API_URL', 'http://evolution.local');
    vi.stubEnv('EVOLUTION_INSTANCE', 'protecta');
    vi.stubEnv('EVOLUTION_API_KEY', 'evo-key');
    const body = JSON.stringify({
      event: 'messages.upsert',
      apikey: 'evo-key',
      data: {
        key: {
          remoteJid: '256701440613@s.whatsapp.net',
          fromMe: false,
          id: 'evo-1',
        },
        message: { conversation: 'calculate' },
      },
    });
    expect((await handler(routeEvent({ rawBody: body }))).status).toBe(200);
    expect(mocked.enqueue).toHaveBeenCalled();
    mocked.enqueue.mockClear();
    expect(
      (await handler(routeEvent({ rawBody: body.replace('evo-key', 'wrong') }))).status,
    ).toBe(401);
  });
  it('answers Meta verification using the configured variable name', async () => {
    vi.stubEnv('WHATSAPP_VERIFY', 'verify-test');
    const response = await verifyHandler(
      routeEvent({
        queryStringParameters: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'verify-test',
          'hub.challenge': 'challenge',
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.body).toBe('challenge');
    const rejected = await verifyHandler(routeEvent());
    expect(rejected.status).toBe(403);
  });
});
