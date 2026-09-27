/**
 * Standalone OCR API - extract data from identity documents without a
 * verification session.
 *
 * Lets external apps reuse this stack's OCR (PaddleOCR/Tesseract + the
 * country-aware extractors + optional LLM fallback) instead of running their
 * own OCR service. Send an image, get the extracted fields back. Nothing is
 * persisted - the image is processed in memory and discarded.
 *
 *   POST /api/v2/ocr/extract           (multipart/form-data)
 *     Auth:   X-API-Key: <your api key>
 *     Fields:
 *       document          image or PDF file (also accepted: "file", "image") - JPG/PNG/WebP/PDF, ≤10 MB
 *       document_type     national_id | passport | drivers_license | auto   (default: auto)
 *       issuing_country   optional ISO-2 country code (e.g. UG, KE) - improves field routing
 *       page              optional 1-based page number for PDFs (default: 1)
 *       include_raw_text  optional "true" to include the full raw OCR text in the response
 *
 *     PDFs are rendered server-side (MuPDF, in memory) to an image and run
 *     through the same OCR pipeline; the response carries source_format and,
 *     for PDFs, { pdf: { page_rendered, page_count } }.
 *
 *     Response 200:
 *       {
 *         success: true,
 *         provider: "engine" | "paddle" | "tesseract",
 *         document_type: "<resolved type>",
 *         issuing_country: "UG" | null,
 *         data: { full_name, date_of_birth, document_number, nationality, sex, expiry_date, ... },
 *         confidence_scores: { <field>: 0..1 },
 *         validation: { is_valid, errors: [], warnings: [] },
 *         processing_ms: 1234
 *       }
 *
 *   GET /api/v2/ocr/health - provider/engine availability probe (same auth).
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import { authenticateAPIKey } from '@/middleware/auth.js';
import { rateLimitMiddleware } from '@/middleware/rateLimit.js';
import { catchAsync, ValidationError } from '@/middleware/errorHandler.js';
import { createOCRProvider } from '@/providers/ocr/index.js';
import engineClient from '@/services/engineClient.js';
import { supabase } from '@/config/database.js';
import config from '@/config/index.js';
import { logger } from '@/utils/logger.js';
import { isPdfBuffer, renderPdfPageToPng } from '@/utils/pdfToImage.js';
import { decryptSecret } from '@kabila/shared';
import type { LLMProviderConfig, OCRProvider } from '@kabila/shared';
import type { OCRData } from '@/types/index.js';

const router = express.Router();

// ── Upload handling (memory only - nothing touches disk) ────────────────────
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});
const uploadFields = upload.fields([
  { name: 'document', maxCount: 1 },
  { name: 'file', maxCount: 1 },
  { name: 'image', maxCount: 1 },
]);

const VALID_DOC_TYPES = new Set(['national_id', 'passport', 'drivers_license', 'auto']);

// ── Local provider (lazy - only initialised when the engine is absent) ─────
let localProvider: OCRProvider | null = null;
function getLocalProvider(): OCRProvider {
  if (!localProvider) localProvider = createOCRProvider();
  return localProvider;
}

// ── Developer LLM config (same lookup the verification flow uses) ──────────
async function getDeveloperLLMConfig(developerId: string): Promise<LLMProviderConfig | undefined> {
  try {
    const { data } = await supabase
      .from('developers')
      .select('llm_provider, llm_api_key_encrypted, llm_endpoint_url')
      .eq('id', developerId)
      .single();
    if (!data?.llm_provider || !data?.llm_api_key_encrypted) return undefined;
    return {
      provider: data.llm_provider as LLMProviderConfig['provider'],
      apiKey: decryptSecret(data.llm_api_key_encrypted, config.encryptionKey),
      endpointUrl: data.llm_endpoint_url || undefined,
    };
  } catch {
    return undefined;
  }
}

// ── Lightweight validation summary (no session required) ───────────────────
function validateOcr(ocrData: OCRData): { is_valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const name = ocrData.name;
  if (!name || name.length < 2) errors.push('Name is missing or too short');

  if (!ocrData.document_number || ocrData.document_number.length < 4) {
    errors.push('Document number is missing or too short');
  }

  const isValidDate = (s: string) => !isNaN(new Date(s).getTime());
  if (ocrData.date_of_birth && !isValidDate(ocrData.date_of_birth)) {
    errors.push('Invalid date of birth format');
  }
  const expiry = ocrData.expiration_date || ocrData.expiry_date;
  if (expiry && isValidDate(expiry) && new Date(expiry) < new Date()) {
    warnings.push('Document appears to be expired');
  }

  const scores = Object.values(ocrData.confidence_scores || {});
  if (scores.length > 0) {
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    if (avg < 0.6) warnings.push('Low OCR confidence scores detected');
  }

  return { is_valid: errors.length === 0, errors, warnings };
}

// ── POST /api/v2/ocr/extract ────────────────────────────────────────────────
router.post(
  '/extract',
  authenticateAPIKey,
  rateLimitMiddleware,
  uploadFields,
  catchAsync(async (req: Request, res: Response) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const file = files?.document?.[0] || files?.file?.[0] || files?.image?.[0];

    if (!file) {
      throw new ValidationError(
        'An image file is required. Send multipart/form-data with a "document" (or "file"/"image") field.',
        'document',
        null,
      );
    }
    if (!ALLOWED_MIME.has((file.mimetype || '').toLowerCase())) {
      throw new ValidationError(
        `Unsupported file type "${file.mimetype}". Supported: JPG, PNG, WebP, PDF.`,
        'document',
        file.mimetype,
      );
    }

    const documentType = (req.body.document_type || 'auto').toLowerCase();
    if (!VALID_DOC_TYPES.has(documentType)) {
      throw new ValidationError(
        'document_type must be one of: national_id, passport, drivers_license, auto',
        'document_type',
        documentType,
      );
    }

    let issuingCountry: string | undefined = (req.body.issuing_country || '').toUpperCase() || undefined;
    if (issuingCountry && !/^[A-Z]{2}$/.test(issuingCountry)) {
      throw new ValidationError(
        'issuing_country must be a 2-letter ISO code (e.g. UG, KE)',
        'issuing_country',
        issuingCountry,
      );
    }

    const includeRawText = String(req.body.include_raw_text || '').toLowerCase() === 'true';
    const developerId = (req as any).developer?.id as string;
    const llmConfig = developerId ? await getDeveloperLLMConfig(developerId) : undefined;

    const start = Date.now();

    // ── PDF handling: render the requested page to a PNG, then run the
    //    normal image OCR pipeline on it. Detected via mimetype OR magic
    //    bytes so misdeclared uploads still work.
    let imageBuffer = file.buffer;
    let sourceFormat: 'image' | 'pdf' = 'image';
    let pdfPageInfo: { page_rendered: number; page_count: number } | null = null;

    const isPdf = (file.mimetype || '').toLowerCase() === 'application/pdf' || isPdfBuffer(file.buffer);
    if (isPdf) {
      const requestedPage = parseInt(req.body.page, 10);
      if (req.body.page != null && req.body.page !== '' && (isNaN(requestedPage) || requestedPage < 1)) {
        throw new ValidationError('page must be a positive integer (1 = first page)', 'page', req.body.page);
      }
      try {
        const rendered = await renderPdfPageToPng(file.buffer, isNaN(requestedPage) ? 1 : requestedPage);
        imageBuffer = rendered.png;
        sourceFormat = 'pdf';
        pdfPageInfo = { page_rendered: rendered.pageRendered, page_count: rendered.pageCount };
      } catch (err: any) {
        throw new ValidationError(
          `Could not read PDF: ${err?.message || 'invalid or corrupted file'}`,
          'document',
          file.originalname,
        );
      }
    }

    let ocrData: OCRData;
    let providerName: string;

    if (engineClient.isEnabled()) {
      // Production path: OCR runs in the engine worker
      ocrData = await engineClient.extractOCR(imageBuffer, documentType, {
        issuingCountry,
        llmConfig,
      });
      providerName = 'engine';
    } else {
      // Dev / single-process path: local provider
      const provider = getLocalProvider();
      ocrData = await provider.processDocument(imageBuffer, documentType, issuingCountry, llmConfig);
      providerName = provider.name;
    }

    const processingMs = Date.now() - start;

    logger.info('Standalone OCR extraction complete', {
      developerId,
      documentType,
      issuingCountry,
      provider: providerName,
      sourceFormat,
      processingMs,
      extractedFields: Object.keys(ocrData).length,
    });

    const { raw_text, confidence_scores, ...fields } = ocrData as Record<string, any>;

    res.json({
      success: true,
      provider: providerName,
      source_format: sourceFormat,
      ...(pdfPageInfo && { pdf: pdfPageInfo }),
      document_type: ocrData.detected_document_type || (documentType === 'auto' ? null : documentType),
      issuing_country: ocrData.issuing_country || issuingCountry || null,
      data: {
        // Stable aliases for the most common fields
        full_name: fields.full_name ?? fields.name ?? null,
        date_of_birth: fields.date_of_birth ?? null,
        document_number: fields.document_number ?? fields.id_number ?? null,
        nationality: fields.nationality ?? null,
        sex: fields.sex ?? null,
        expiry_date: fields.expiry_date ?? fields.expiration_date ?? null,
        address: fields.address ?? null,
        issuing_authority: fields.issuing_authority ?? null,
        // Everything else the extractor found (country-specific fields such as
        // NIN, card_number, district, height, eye_color, MRZ fields, …)
        ...fields,
      },
      confidence_scores: confidence_scores || {},
      ...(includeRawText && { raw_text: raw_text ?? null }),
      validation: validateOcr(ocrData),
      processing_ms: processingMs,
    });
  }),
);

// ── GET /api/v2/ocr/health ──────────────────────────────────────────────────
router.get(
  '/health',
  authenticateAPIKey,
  catchAsync(async (_req: Request, res: Response) => {
    res.json({
      success: true,
      mode: engineClient.isEnabled() ? 'engine' : 'local',
      supported_document_types: ['national_id', 'passport', 'drivers_license', 'auto'],
      supported_formats: ['jpg', 'png', 'webp', 'pdf'],
      max_file_size_bytes: 10 * 1024 * 1024,
      accepted_mime_types: [...ALLOWED_MIME],
    });
  }),
);

export default router;
