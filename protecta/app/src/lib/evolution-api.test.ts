import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  evolutionWebhookAuthorized,
  isEvolutionPayload,
  parseEvolutionInbound,
  sendEvolutionDocument,
} from 'src/lib/evolution-api';
import { routeEvent } from 'src/test-utils/route-event';

const payload = {
  event: 'messages.upsert',
  instance: 'protecta',
  apikey: 'evo-key',
  data: {
    key: {
      remoteJid: '256701440613@s.whatsapp.net',
      fromMe: false,
      id: 'MSG1',
    },
    message: { conversation: '1' },
    messageTimestamp: 1710000000,
  },
};

describe('Evolution inbound', () => {
  it('recognises an Evolution webhook and ignores Meta payloads', () => {
    expect(isEvolutionPayload(payload)).toBe(true);
    expect(isEvolutionPayload({ entry: [] })).toBe(false);
  });

  it('reads a customer number and text, and skips messages we sent', () => {
    expect(parseEvolutionInbound(payload)).toEqual([
      {
        from: '+256701440613',
        text: '1',
        id: 'MSG1',
        timestamp: '1710000000',
      },
    ]);
    expect(
      parseEvolutionInbound({
        event: 'MESSAGES_UPSERT',
        data: { key: { remoteJid: '256701440613@s.whatsapp.net', fromMe: true, id: 'x' }, message: { conversation: 'hi' } },
      }),
    ).toEqual([]);
  });

  it('accepts the instance key from the header or the body', () => {
    const config = { baseUrl: 'http://evolution.local', instance: 'protecta', apiKey: 'evo-key' };
    expect(evolutionWebhookAuthorized({ apikey: 'evo-key' }, {}, config)).toBe(true);
    expect(evolutionWebhookAuthorized({}, payload, config)).toBe(true);
    expect(evolutionWebhookAuthorized(routeEvent().headers, { apikey: 'nope' }, config)).toBe(false);
  });
});

describe('Evolution document send', () => {
  const config = {
    baseUrl: 'http://evolution.local',
    instance: 'protecta',
    apiKey: 'evo-key',
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the document as media with base64 payload', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ key: { id: 'EVO-DOC-1' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const doc = {
      fileName: 'Protecta-Quote-482913.pdf',
      caption: 'Protecta Bode quote 482913: UGX 150,000 premium.',
      base64: Buffer.from('%PDF-fake').toString('base64'),
    };
    const result = await sendEvolutionDocument(config, '+256772000000', doc);
    expect(result).toEqual({ messageId: 'EVO-DOC-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/message/sendMedia/protecta');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      number: '256772000000',
      mediatype: 'document',
      mimetype: 'application/pdf',
      fileName: doc.fileName,
      caption: doc.caption,
      media: doc.base64,
    });
  });

  it('reports the upstream status when the send fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: 'boom' }),
        text: async () => 'boom',
      })),
    );
    await expect(
      sendEvolutionDocument(config, '256772000000', {
        fileName: 'x.pdf',
        caption: 'x',
        base64: 'eA==',
      }),
    ).rejects.toThrow(/Evolution media send failed \(500\)/);
  });
});
