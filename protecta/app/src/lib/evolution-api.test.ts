import { describe, expect, it } from 'vitest';
import {
  evolutionWebhookAuthorized,
  isEvolutionPayload,
  parseEvolutionInbound,
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
