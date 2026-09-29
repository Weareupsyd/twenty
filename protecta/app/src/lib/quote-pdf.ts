import { PDFDocument, StandardFonts } from 'pdf-lib';
import { formatUgx } from 'src/lib/money';
import { brandFooter, createSheet, NAVY, ORANGE } from 'src/lib/pdf-draw';
import { type RecordData } from 'src/lib/records';

/**
 * The customer-facing quote document: what the WhatsApp bot attaches next
 * to its text reply and what /s/protecta/quotes/pdf serves.
 */
export const generateQuotePdf = async (
  quote: RecordData,
  options: { name?: string; baseUrl?: string } = {},
): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage();
  const sheet = createSheet(page, { font, bold }, 'Motor quote');

  const ref = String(quote.reference ?? '');
  const status = String(quote.status ?? 'QUOTED');
  const validUntil = String(quote.validUntil ?? '—');
  const base = (options.baseUrl ?? '').replace(/\/$/, '');
  const payUrl =
    String(quote.shareUrl ?? '').trim() ||
    `${base}/s/protecta/quotes/view?ref=${encodeURIComponent(ref)}`;

  sheet.heading('Motor Insurance Quote');
  sheet.note(`Quote ${ref}  ·  ${status}  ·  valid until ${validUntil}`);
  sheet.gap(6);

  sheet.row('Policyholder', options.name || '—');
  sheet.row('Phone', String(quote.policyholderPhone ?? '—'));
  sheet.row(
    'Vehicle',
    `${String(quote.vehicleMake ?? '')} ${String(quote.vehicleModel ?? '')}`.trim() || '—',
  );
  sheet.row('Number plate', String(quote.plate ?? '—'));
  sheet.row('Vehicle value', formatUgx(Number(quote.vehicleValue ?? 0)));
  sheet.row('Annual premium', formatUgx(Number(quote.premium ?? 0)));
  sheet.gap(4);
  sheet.note(
    'Premium is 1.5% of the vehicle value for 12 months of cover: car body, third party and driver.',
  );
  sheet.gap(6);

  sheet.draw('Approve payment', 13, bold, NAVY);
  sheet.gap(2);
  sheet.draw(payUrl, 10, font, ORANGE);
  sheet.gap(2);
  sheet.note(
    'Open the link to pay by MTN MoMo, Airtel Money or bank transfer — or reply 4 on WhatsApp and send this quote reference.',
  );
  sheet.gap(4);
  sheet.note(
    'Terms and Conditions apply. This quote is valid until the date above; cover starts once payment confirms.',
  );

  sheet.gap(8);
  sheet.rule();
  brandFooter(sheet);

  return doc.save();
};

export const quotePdfFileName = (quote: RecordData): string =>
  `Protecta-Quote-${String(quote.reference ?? 'quote').replace(/[^A-Za-z0-9-]/g, '')}.pdf`;

// Captions are WhatsApp text: never emoji, never '&'. Names are user
// input, so scrub them before they reach the caption.
const captionSafe = (value: string): string =>
  value
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();

export const quotePdfCaption = (quote: RecordData, name?: string): string => {
  const ref = String(quote.reference ?? '');
  const premium = formatUgx(Number(quote.premium ?? 0));
  const who = name ? ` for ${captionSafe(name)}` : '';
  return (
    `Protecta Bode quote ${ref}${who}: ${premium} premium, valid until ` +
    `${String(quote.validUntil ?? '')}. The PDF has the full quote and payment link.`
  );
};
