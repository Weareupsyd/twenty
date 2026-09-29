import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  paymentInvoiceDocument,
  quotePdfDocument,
} from 'src/lib/conversation-docs';
import {
  expectWhatsAppSafe,
  isPdf,
} from 'src/test-utils/pdf-content';

const quote = {
  reference: '482913',
  status: 'QUOTED',
  premium: 150000,
  validUntil: '31 Oct 2026',
  createdAt: '2026-09-29T10:00:00.000Z',
  policyholderName: 'Jane Doe',
  policyholderPhone: '+256772000000',
  plate: 'UAX 123C',
  vehicleMake: 'Toyota',
  vehicleModel: 'Premio',
  vehicleValue: 10000000,
  shareUrl: 'https://protectabode.weareupsyd.com/s/protecta/quotes/view?ref=482913',
};

const decode = (base64: string): Uint8Array => new Uint8Array(Buffer.from(base64, 'base64'));

describe('WhatsApp conversation documents', () => {
  it('packages the quote PDF as base64 with a safe caption', async () => {
    const doc = await quotePdfDocument(quote, { name: 'Jane Doe' });
    expect(doc.fileName).toBe('Protecta-Quote-482913.pdf');
    expect(doc.mimeType).toBe('application/pdf');
    expectWhatsAppSafe(doc.caption);
    expect(doc.caption).toContain('482913');
    const bytes = decode(doc.base64);
    expect(isPdf(bytes)).toBe(true);
    await PDFDocument.load(bytes);
    // base64 round-trips losslessly: regenerating produces the same size.
    const again = await quotePdfDocument(quote, { name: 'Jane Doe' });
    expect(Buffer.from(again.base64, 'base64').length).toBe(
      Buffer.from(doc.base64, 'base64').length,
    );
  });
  it('packages the invoice as INV-ref with a safe caption', async () => {
    const doc = await paymentInvoiceDocument(quote, {
      name: 'Jane Doe',
      payerPhone: '+256772000000',
    });
    expect(doc.fileName).toBe('Protecta-Invoice-INV-482913.pdf');
    expect(doc.mimeType).toBe('application/pdf');
    expectWhatsAppSafe(doc.caption);
    expect(doc.caption).toContain('INV-482913');
    const bytes = decode(doc.base64);
    expect(isPdf(bytes)).toBe(true);
    await PDFDocument.load(bytes);
  });
  it('keeps captions clean when names carry emoji or &', async () => {
    const q = { ...quote, policyholderName: 'A & B \u{1F600}' };
    const doc = await quotePdfDocument(q, { name: 'A & B \u{1F600}' });
    expectWhatsAppSafe(doc.caption);
    const inv = await paymentInvoiceDocument(q, { name: 'A & B \u{1F600}' });
    expectWhatsAppSafe(inv.caption);
  });
});
