import { PDFDocument, StandardFonts } from 'pdf-lib';
import { renderReceiptHtml } from 'src/lib/billing-document-html';
import { renderHtmlToPdf } from 'src/lib/html-pdf';
import { formatUgx } from 'src/lib/money';
import { brandFooter, createSheet, embedBrandLogo, INK, NAVY } from 'src/lib/pdf-draw';
import { type RecordData } from 'src/lib/records';

/**
 * The payment receipt: issued once an insurancePayment confirms, and attached
 * to the confirmation message on WhatsApp. Rendered from the billing document
 * HTML template through the Chromium renderer, with a drawn pdf-lib fallback
 * so a confirmed payment always produces a receipt.
 */
export const generatePaymentReceipt = async (input: {
  payment: RecordData;
  quote: RecordData;
  policy?: RecordData | null;
  name?: string;
}): Promise<Uint8Array> => {
  try {
    return await renderHtmlToPdf(renderReceiptHtml(input));
  } catch (error) {
    console.warn(
      'receipt: HTML renderer unavailable, falling back to the drawn PDF',
      error,
    );
    return drawPaymentReceipt(input);
  }
};

const drawPaymentReceipt = async (input: {
  payment: RecordData;
  quote: RecordData;
  policy?: RecordData | null;
  name?: string;
}): Promise<Uint8Array> => {
  const { payment, quote, policy } = input;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage();
  const sheet = createSheet(page, { font, bold }, 'Payment receipt', await embedBrandLogo(doc));

  const ref = String(payment.protectaRef ?? payment.paymentRef ?? '');
  const amount = Number(payment.amountUgx ?? quote.premium ?? 0);
  const provider = String(payment.provider ?? 'Mobile Money');
  const providerRef = String(payment.providerRef ?? '');

  sheet.heading('Payment Receipt');
  sheet.note(
    `Receipt RCP-${ref}  ·  ${new Date().toISOString().slice(0, 10)}`,
  );
  sheet.gap(6);

  sheet.row('Received from', input.name || 'Protecta Bode customer');
  sheet.row(
    'Vehicle',
    `${String(quote.vehicleMake ?? '')} ${String(quote.vehicleModel ?? '')}`.trim() || '—',
  );
  sheet.row('Number plate', String(quote.plate ?? '—'));
  sheet.row('Paid via', providerRef ? `${provider} (${providerRef})` : provider);
  sheet.row('Amount received', `${formatUgx(amount)}`);
  sheet.row('Quote', String(quote.reference ?? '—'));
  if (policy?.policyNo) {
    sheet.row('Policy', String(policy.policyNo));
  }
  sheet.gap(6);

  sheet.draw('Thank you', 13, bold, NAVY);
  sheet.gap(2);
  sheet.draw(
    'Your payment is confirmed. Keep this receipt with your policy documents.',
    10,
    font,
    INK,
  );

  sheet.gap(8);
  sheet.rule();
  brandFooter(sheet);

  return doc.save();
};

export const receiptFileName = (payment: RecordData): string =>
  `Protecta-Receipt-RCP-${String(payment.protectaRef ?? payment.paymentRef ?? 'payment').replace(/[^A-Za-z0-9-]/g, '')}.pdf`;

// Captions are WhatsApp text: never emoji, never '&'.
const captionSafe = (value: string): string =>
  value
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();

export const receiptCaption = (
  payment: RecordData,
  quote: RecordData,
  policy?: RecordData | null,
): string => {
  const ref = String(payment.protectaRef ?? payment.paymentRef ?? '');
  const amount = formatUgx(Number(payment.amountUgx ?? quote.premium ?? 0));
  const policyNo = policy?.policyNo ? ` Policy ${captionSafe(String(policy.policyNo))} is active.` : '';
  return (
    `Protecta Bode receipt RCP-${ref}: ${amount} received for quote ` +
    `${captionSafe(String(quote.reference ?? ''))}.${policyNo} Thank you.`
  );
};
