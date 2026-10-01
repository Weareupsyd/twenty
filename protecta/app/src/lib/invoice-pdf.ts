import { PDFDocument, StandardFonts } from 'pdf-lib';
import { renderInvoiceHtml } from 'src/lib/billing-document-html';
import { BANK_TRANSFER } from 'src/lib/bank-transfer';
import { renderHtmlToPdf } from 'src/lib/html-pdf';
import { formatUgx } from 'src/lib/money';
import { brandFooter, createSheet, embedBrandLogo, INK, NAVY, ORANGE } from 'src/lib/pdf-draw';
import { type RecordData } from 'src/lib/records';

export { BANK_TRANSFER };

/**
 * The payment invoice for a quote: generated when the customer starts the
 * pay flow in WhatsApp and attached next to the text reply. Until a provider
 * confirms, it is a proforma invoice (amount due, how to pay, pay link).
 *
 * Rendered from the billing document HTML template through the Chromium
 * renderer; when that renderer is not deployed the invoice is still produced,
 * drawn with pdf-lib, so a WhatsApp pay flow never fails on missing infra.
 */
export const generatePaymentInvoice = async (
  quote: RecordData,
  options: { name?: string; payerPhone?: string; baseUrl?: string } = {},
): Promise<Uint8Array> => {
  const ref = String(quote.reference ?? '');
  const base = (options.baseUrl ?? '').replace(/\/$/, '');
  const payUrl =
    String(quote.shareUrl ?? '').trim() ||
    `${base}/s/protecta/quotes/view?ref=${encodeURIComponent(ref)}`;

  try {
    return await renderHtmlToPdf(
      renderInvoiceHtml({
        quote,
        ...(options.name ? { name: options.name } : {}),
        ...(options.payerPhone ? { payerPhone: options.payerPhone } : {}),
        payUrl,
      }),
    );
  } catch (error) {
    console.warn(
      'invoice: HTML renderer unavailable, falling back to the drawn PDF',
      error,
    );
    return drawPaymentInvoice(quote, options, payUrl);
  }
};

const drawPaymentInvoice = async (
  quote: RecordData,
  options: { name?: string; payerPhone?: string } = {},
  payUrl: string,
): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage();
  const sheet = createSheet(page, { font, bold }, 'Payment invoice', await embedBrandLogo(doc));

  const ref = String(quote.reference ?? '');
  const payer = options.payerPhone || String(quote.policyholderPhone ?? '—');
  const amount = Number(quote.premium ?? 0);

  sheet.heading('Payment Invoice');
  sheet.note(
    `Invoice INV-${ref}  ·  quote ${ref}  ·  ${new Date().toISOString().slice(0, 10)}`,
  );
  sheet.gap(6);

  sheet.row('Bill to', options.name || 'Protecta Bode customer');
  sheet.row('Phone', payer);
  sheet.row(
    'Vehicle',
    `${String(quote.vehicleMake ?? '')} ${String(quote.vehicleModel ?? '')}`.trim() || '—',
  );
  sheet.row('Number plate', String(quote.plate ?? '—'));
  sheet.row('Amount due', `${formatUgx(amount)} ${BANK_TRANSFER.currency}`);
  sheet.row('Due before', String(quote.validUntil ?? '—'));
  sheet.gap(6);

  sheet.draw('How to pay', 13, bold, NAVY);
  sheet.gap(2);
  sheet.draw(
    `MTN MoMo or Airtel Money: open the payment link and approve the prompt on ${payer}.`,
    10,
    font,
    INK,
  );
  sheet.draw(
    `Bank transfer: ${BANK_TRANSFER.bank}, account ${BANK_TRANSFER.account}, reference ${ref}.`,
    10,
    font,
    INK,
  );
  sheet.gap(4);
  sheet.draw('Payment link', 12, bold, NAVY);
  sheet.gap(2);
  sheet.draw(payUrl, 10, font, ORANGE);
  sheet.gap(6);
  sheet.note(
    'Cover activates once payment confirms. Keep this invoice and quote reference ' +
      `${ref} for follow-up.`,
  );

  sheet.gap(8);
  sheet.rule();
  brandFooter(sheet);

  return doc.save();
};

export const invoiceFileName = (quote: RecordData): string =>
  `Protecta-Invoice-INV-${String(quote.reference ?? 'quote').replace(/[^A-Za-z0-9-]/g, '')}.pdf`;

// Captions are WhatsApp text: never emoji, never '&'. Names are user
// input, so scrub them before they reach the caption.
const captionSafe = (value: string): string =>
  value
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();

export const invoiceCaption = (quote: RecordData, payerPhone?: string): string => {
  const ref = String(quote.reference ?? '');
  const amount = formatUgx(Number(quote.premium ?? 0));
  const via = payerPhone ? ` on ${captionSafe(payerPhone)}` : '';
  return (
    `Protecta Bode invoice INV-${ref}: ${amount} due for quote ${ref}. ` +
    `Pay via MTN MoMo, Airtel Money or bank transfer${via}.`
  );
};
