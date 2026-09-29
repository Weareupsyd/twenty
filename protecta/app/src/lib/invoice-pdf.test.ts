import { describe, expect, it } from 'vitest';
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
