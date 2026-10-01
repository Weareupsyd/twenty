import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  BANK_TRANSFER,
  generatePaymentInvoice,
  invoiceCaption,
  invoiceFileName,
} from 'src/lib/invoice-pdf';
import {
  expectWhatsAppSafe,
  isPdf,
  pdfContains,
} from 'src/test-utils/pdf-content';

const quote = {
  reference: '482913',
  status: 'QUOTED',
  premium: 150000,
  validUntil: '31 Oct 2026',
  createdAt: '2026-09-29T10:00:00.000Z',
  policyholderPhone: '+256772000000',
  plate: 'UAX 123C',
  vehicleMake: 'Toyota',
  vehicleModel: 'Premio',
  vehicleValue: 10000000,
  shareUrl: 'https://protectabode.weareupsyd.com/s/protecta/quotes/view?ref=482913',
};

// Without a renderer the invoice is drawn with pdf-lib, exactly as before the
// HTML templates existed.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('renderer unreachable');
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('payment invoice PDF', () => {
  it('renders the invoice with amount, bank details, and the payer', async () => {
    const bytes = await generatePaymentInvoice(quote, {
      name: 'Jane Doe',
      payerPhone: '+256772000000',
    });
    expect(isPdf(bytes)).toBe(true);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(pdfContains(bytes, 'INV-482913')).toBe(true);
    expect(pdfContains(bytes, BANK_TRANSFER.account)).toBe(true);
    expect(pdfContains(bytes, 'Stanbic Bank Uganda')).toBe(true);
    expect(pdfContains(bytes, '+256772000000')).toBe(true);
    expect(pdfContains(bytes, 'UGX 150,000')).toBe(true);
  });
  it('matches the bank details the payment instructions use', () => {
    expect(BANK_TRANSFER).toEqual({
      bank: 'Stanbic Bank Uganda',
      account: '9030005603063',
      currency: 'UGX',
    });
  });
  it('survives unicode and emoji in names', async () => {
    const bytes = await generatePaymentInvoice(quote, {
      name: 'Jos\u00e9 \u{1F600} \u4E2D\u6587',
      payerPhone: '+256772000000',
    });
    expect(isPdf(bytes)).toBe(true);
    await PDFDocument.load(bytes);
  });
  it('names the file INV-ref and writes an emoji-free caption without &', () => {
    expect(invoiceFileName(quote)).toBe('Protecta-Invoice-INV-482913.pdf');
    const caption = invoiceCaption(quote, '+256772000000');
    expectWhatsAppSafe(caption);
    expect(caption).toContain('INV-482913');
    expect(caption).toContain('UGX 150,000');
    expect(caption).toContain('+256772000000');
  });
});

describe('payment invoice through the HTML template', () => {
  it('submits the rendered template to the Chromium renderer', async () => {
    const rendered = new TextEncoder().encode('%PDF-1.7\nrendered-invoice');
    const fetchMock = vi.fn(async () => new Response(rendered, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const bytes = await generatePaymentInvoice(quote, {
      name: 'Jane Doe',
      payerPhone: '+256772000000',
      baseUrl: 'https://protectabode.weareupsyd.com',
    });

    expect(bytes).toEqual(rendered);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const form = request.body as FormData;
    const html = await (form.get('files') as File).text();
    expect(html).toContain('INV-482913');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('Stanbic Bank Uganda');
    expect(html).toContain(quote.shareUrl);
    expect(html).toContain('data:image/png;base64,');
  });

  it('falls back to the drawn PDF when the renderer answers with an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 503 })),
    );
    const bytes = await generatePaymentInvoice(quote, { name: 'Jane Doe' });
    expect(isPdf(bytes)).toBe(true);
    expect(pdfContains(bytes, 'INV-482913')).toBe(true);
  });
});
