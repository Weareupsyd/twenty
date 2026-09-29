import {
  generatePaymentInvoice,
  invoiceCaption,
  invoiceFileName,
} from 'src/lib/invoice-pdf';
import { generateQuotePdf, quotePdfCaption, quotePdfFileName } from 'src/lib/quote-pdf';
import { publicBaseUrl } from 'src/lib/http';
import { type RecordData } from 'src/lib/records';
import { type OutboundWhatsAppDocument } from 'src/lib/whatsapp-transport';

/**
 * A WhatsApp document attachment (PDF) that accompanies a bot/staff text
 * reply. The bytes are generated at send time — the conversation receipt in
 * KV only stores which document to rebuild, so retries stay tiny.
 */
export type { OutboundWhatsAppDocument };

export const quotePdfDocument = async (
  quote: RecordData,
  options: { name?: string } = {},
): Promise<OutboundWhatsAppDocument> => {
  const bytes = await generateQuotePdf(quote, {
    ...(options.name ? { name: options.name } : {}),
    baseUrl: publicBaseUrl(),
  });
  return {
    fileName: quotePdfFileName(quote),
    caption: quotePdfCaption(quote, options.name),
    base64: Buffer.from(bytes).toString('base64'),
    mimeType: 'application/pdf',
  };
};

export const paymentInvoiceDocument = async (
  quote: RecordData,
  options: { name?: string; payerPhone?: string } = {},
): Promise<OutboundWhatsAppDocument> => {
  const bytes = await generatePaymentInvoice(quote, {
    ...(options.name ? { name: options.name } : {}),
    ...(options.payerPhone ? { payerPhone: options.payerPhone } : {}),
    baseUrl: publicBaseUrl(),
  });
  return {
    fileName: invoiceFileName(quote),
    caption: invoiceCaption(quote, options.payerPhone),
    base64: Buffer.from(bytes).toString('base64'),
    mimeType: 'application/pdf',
  };
};
