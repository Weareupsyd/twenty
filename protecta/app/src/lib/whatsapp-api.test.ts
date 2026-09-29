import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendWhatsAppDocument } from 'src/lib/whatsapp-api';

describe('Meta document send', () => {
  const config = { token: 'meta-token', phoneId: 'PHONE_ID_9' };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads the PDF then sends it as a document message', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).endsWith('/media')) {
        expect(init.body).toBeInstanceOf(FormData);
        const form = init.body as FormData;
        expect(form.get('type')).toBe('document');
        const file = form.get('file');
        expect(file).toBeTruthy();
        return { ok: true, json: async () => ({ id: 'MEDIA_OBJ_7' }) };
      }
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({
        messaging_product: 'whatsapp',
        to: '256772000000',
        type: 'document',
        document: {
          id: 'MEDIA_OBJ_7',
          filename: 'Protecta-Quote-482913.pdf',
          caption: 'Protecta Bode quote 482913.',
        },
      });
      return { ok: true, json: async () => ({ messages: [{ id: 'wamid.abc' }] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendWhatsAppDocument(config, '+256772000000', {
      fileName: 'Protecta-Quote-482913.pdf',
      caption: 'Protecta Bode quote 482913.',
      base64: Buffer.from('%PDF-fake').toString('base64'),
    });
    expect(result.messageId).toBe('wamid.abc');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [uploadUrl] = fetchMock.mock.calls[0] as unknown as [string];
    const [messageUrl] = fetchMock.mock.calls[1] as unknown as [string];
    expect(uploadUrl).toBe('https://graph.facebook.com/v21.0/PHONE_ID_9/media');
    expect(messageUrl).toBe('https://graph.facebook.com/v21.0/PHONE_ID_9/messages');
  });

  it('fails loudly when the media upload is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => 'bad token',
        json: async () => ({}),
      })),
    );
    await expect(
      sendWhatsAppDocument(config, '256772000000', {
        fileName: 'x.pdf',
        caption: 'x',
        base64: 'eA==',
      }),
    ).rejects.toThrow(/WhatsApp media upload failed \(401\)/);
  });

  it('fails when the upload returns no media id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    await expect(
      sendWhatsAppDocument(config, '256772000000', {
        fileName: 'x.pdf',
        caption: 'x',
        base64: 'eA==',
      }),
    ).rejects.toThrow('WhatsApp media upload returned no media id.');
  });
});
