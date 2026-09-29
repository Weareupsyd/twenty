import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  generateQuotePdf,
  quotePdfCaption,
  quotePdfFileName,
} from 'src/lib/quote-pdf';
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
  policyholderName: 'Jane Doe',
  policyholderPhone: '+256772000000',
  plate: 'UAX 123C',
  vehicleMake: 'Toyota',
  vehicleModel: 'Premio',
  vehicleValue: 10000000,
  shareUrl: 'https://protectabode.weareupsyd.com/s/protecta/quotes/view?ref=482913',
};

describe('quote PDF', () => {
  it('renders a one-page A4 PDF with the quote facts on it', async () => {
    const bytes = await generateQuotePdf(quote, { name: 'Jane Doe' });
    expect(isPdf(bytes)).toBe(true);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(pdfContains(bytes, '482913')).toBe(true);
    expect(pdfContains(bytes, 'UAX 123C')).toBe(true);
    expect(pdfContains(bytes, 'Toyota')).toBe(true);
    expect(pdfContains(bytes, 'Approve payment')).toBe(true);
  });
  it('survives names and plates with unicode and emoji', async () => {
    const bytes = await generateQuotePdf(
      { ...quote, plate: 'UAX \u{1F600}123', policyholderName: 'Jos\u00e9 "N\u00e8" \u4E2D\u6587' },
      { name: 'Jos\u00e9 \u{1F600} \u4E2D\u6587' },
    );
    expect(isPdf(bytes)).toBe(true);
    await PDFDocument.load(bytes);
  });
  it('names the file and writes an emoji-free caption without &', () => {
    expect(quotePdfFileName(quote)).toBe('Protecta-Quote-482913.pdf');
    const caption = quotePdfCaption(quote, 'Jane & \u{1F600} Doe');
    expectWhatsAppSafe(caption);
    expect(caption).toContain('482913');
    expect(caption).toContain('UGX 150,000');
    expect(caption).toContain('Jane and Doe');
  });
});
