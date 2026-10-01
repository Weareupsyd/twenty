import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  generatePaymentReceipt,
  receiptCaption,
  receiptFileName,
} from 'src/lib/receipt-pdf';
import { expectWhatsAppSafe, isPdf, pdfContains } from 'src/test-utils/pdf-content';

const quote = {
  reference: '482913',
  premium: 150000,
  policyholderPhone: '+256772000000',
  plate: 'UAX 123C',
  vehicleMake: 'Toyota',
  vehicleModel: 'Premio',
};

const payment = {
  id: 'pay-1',
  protectaRef: 'R-1001',
  paymentRef: 'MTN-88412',
  quoteRef: '482913',
  provider: 'MTN',
  providerRef: 'MTN-88412',
  payerPhone: '+256772000000',
  amountUgx: 150000,
  status: 'CONFIRMED',
};

const policy = { policyNo: 'PB-2026-0007', periodStart: '30 Sep 2026', periodEnd: '29 Sep 2027' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generatePaymentReceipt', () => {
  it('uses the HTML template through the Chromium renderer when available', async () => {
    const rendered = new TextEncoder().encode('%PDF-1.7\nrendered-receipt');
    const fetchMock = vi.fn(async () => new Response(rendered, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const bytes = await generatePaymentReceipt({ payment, quote, policy, name: 'Jane Doe' });

    expect(bytes).toEqual(rendered);
    const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const form = request.body as FormData;
    const html = await (form.get('files') as File).text();
    expect(html).toContain('RCP-R-1001');
    expect(html).toContain('Paid via <b>MTN MoMo</b>');
    expect(html).toContain('PB-2026-0007');
  });

  it('falls back to a drawn PDF when the renderer is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    const bytes = await generatePaymentReceipt({ payment, quote, policy, name: 'Jane Doe' });

    expect(isPdf(bytes)).toBe(true);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(pdfContains(bytes, 'RCP-R-1001')).toBe(true);
    expect(pdfContains(bytes, 'UGX 150,000')).toBe(true);
    expect(pdfContains(bytes, 'PB-2026-0007')).toBe(true);
    expect(pdfContains(bytes, 'MTN-88412')).toBe(true);
  });

  it('survives unicode and emoji in names', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const bytes = await generatePaymentReceipt({
      payment,
      quote,
      name: 'Jos\u00e9 \u{1F600} \u4E2D\u6587',
    });
    expect(isPdf(bytes)).toBe(true);
    await PDFDocument.load(bytes);
  });
});

describe('file name and caption', () => {
  it('names the file RCP-ref', () => {
    expect(receiptFileName(payment)).toBe('Protecta-Receipt-RCP-R-1001.pdf');
  });

  it('writes an emoji-free caption without &', () => {
    const caption = receiptCaption(payment, quote, policy);
    expectWhatsAppSafe(caption);
    expect(caption).toContain('RCP-R-1001');
    expect(caption).toContain('UGX 150,000');
    expect(caption).toContain('482913');
    expect(caption).toContain('PB-2026-0007');
  });
});
