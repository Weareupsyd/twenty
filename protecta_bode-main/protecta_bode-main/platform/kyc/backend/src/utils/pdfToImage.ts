/**
 * PDF -> image conversion for OCR.
 *
 * Renders a page of a PDF document to a PNG buffer using MuPDF (pure WASM -
 * no system packages like Ghostscript/GraphicsMagick required), so PDF
 * uploads can flow through the exact same OCR pipeline as camera images.
 *
 * The module is imported lazily so deployments that never receive PDFs
 * don't pay the WASM startup cost.
 */

import { logger } from '@/utils/logger.js';

let mupdfModule: typeof import('mupdf') | null = null;

async function getMupdf() {
  if (!mupdfModule) {
    mupdfModule = await import('mupdf');
  }
  return mupdfModule;
}

/** Quick magic-byte check - %PDF- */
export function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

export interface PdfRenderResult {
  png: Buffer;
  pageCount: number;
  pageRendered: number; // 1-based
}

/**
 * Render one page of a PDF to a PNG buffer.
 *
 * @param buffer  The PDF file contents.
 * @param page    1-based page number (default 1 - ID documents are normally single-page scans).
 * @param scale   Zoom factor applied to the page (default 3 ≈ 216 DPI - enough
 *                detail for OCR without producing enormous bitmaps).
 */
export async function renderPdfPageToPng(
  buffer: Buffer,
  page: number = 1,
  scale: number = 3,
): Promise<PdfRenderResult> {
  const mupdf = await getMupdf();

  const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  try {
    const pageCount = doc.countPages();
    if (pageCount < 1) {
      throw new Error('PDF contains no pages');
    }
    const target = Math.min(Math.max(1, Math.floor(page)), pageCount);

    const pdfPage = doc.loadPage(target - 1);
    try {
      const pixmap = pdfPage.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
        false, // no alpha - OCR wants a flat white background
        true,
      );
      try {
        const png = Buffer.from(pixmap.asPNG());
        logger.info('Rendered PDF page for OCR', {
          pageRendered: target,
          pageCount,
          pngBytes: png.length,
        });
        return { png, pageCount, pageRendered: target };
      } finally {
        pixmap.destroy();
      }
    } finally {
      pdfPage.destroy();
    }
  } finally {
    doc.destroy();
  }
}
