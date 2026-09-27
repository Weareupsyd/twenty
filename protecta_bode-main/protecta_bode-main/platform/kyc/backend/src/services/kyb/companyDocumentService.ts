/**
 * Company document ingestion - upload -> store -> OCR -> extract -> cross-check.
 *
 * Reuses the existing OCR provider stack (`createOCRProvider`) for text
 * recognition and the existing StorageService for the file itself, so a KYB
 * deployment inherits whatever OCR engine the operator already configured.
 * Only the field extraction is KYB-specific, because company documents carry
 * different facts from identity documents.
 */

import { logger } from '@/utils/logger.js';
import { StorageService } from '@/services/storage.js';
import { createOCRProvider } from '@/providers/ocr/index.js';
import type { OCRProvider } from '@kabila/shared';

import {
  extractCompanyFields,
  type CompanyExtractionResult,
} from './companyDocumentExtractor.js';

export interface IngestDocumentInput {
  businessSessionId: string;
  documentType: string;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

export interface IngestDocumentResult {
  file_path: string;
  extraction: CompanyExtractionResult;
  /** Raw OCR text - needed by the tamper heuristics, which reason over prose. */
  raw_text: string;
  /** False when OCR itself failed - the file is still stored for an analyst. */
  ocr_succeeded: boolean;
  ocr_error?: string;
}

/**
 * Tamper heuristics.
 *
 * This is intentionally modest: it flags documents whose text layer is
 * missing or implausibly sparse, which catches blank scans, photos of
 * screens, and re-saved images far more often than it catches deliberate
 * forgery. It is a triage signal for an analyst, not a forensic verdict, and
 * it is named accordingly so nobody mistakes it for one.
 */
export function assessTamperSignals(rawText: string, extraction: CompanyExtractionResult): {
  passed: boolean | null;
  notes: string | null;
} {
  const text = (rawText ?? '').trim();

  if (text.length === 0) {
    return { passed: null, notes: 'No text layer could be read - manual inspection required' };
  }

  const notes: string[] = [];

  if (text.length < 120) {
    notes.push('Very little text recovered from the document');
  }

  if (extraction.overall_confidence !== null && extraction.overall_confidence < 0.55) {
    notes.push(`Low OCR confidence (${extraction.overall_confidence})`);
  }

  if (extraction.fields_extracted === 0) {
    notes.push('None of the expected fields were found');
  }

  // A certificate that mentions neither a company nor a registrar is unlikely
  // to be the document it claims to be.
  if (!/\b(company|registrar|incorporat|certificate|limited|ltd|registry)\b/i.test(text)) {
    notes.push('Document does not read like a company record');
  }

  return {
    passed: notes.length === 0,
    notes: notes.length > 0 ? notes.join('; ') : null,
  };
}

let cachedProvider: OCRProvider | null = null;
function provider(): OCRProvider {
  if (!cachedProvider) cachedProvider = createOCRProvider();
  return cachedProvider;
}

/** Test seam - lets the suite inject a fake OCR provider. */
export function __setOcrProviderForTests(p: OCRProvider | null): void {
  cachedProvider = p;
}

/**
 * Store the file, run OCR over it, and extract company fields.
 *
 * OCR failure is not fatal. The document is still stored and recorded so an
 * analyst can open it - losing the upload because the text layer was
 * unreadable would be worse than surfacing it for manual review.
 */
export async function ingestCompanyDocument(
  input: IngestDocumentInput,
  storage: StorageService = new StorageService(),
): Promise<IngestDocumentResult> {
  const filePath = await storage.storeDocument(
    input.buffer,
    input.fileName,
    input.mimeType,
    input.businessSessionId,
  );

  try {
    const ocr = await provider().processDocument(input.buffer, 'auto');
    const rawText = ocr.raw_text ?? '';

    const scores = Object.values(ocr.confidence_scores ?? {});
    const providerConfidence = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0.8;

    const extraction = extractCompanyFields(rawText, input.documentType, providerConfidence);

    logger.info('Company document OCR complete', {
      businessSessionId: input.businessSessionId,
      documentType: input.documentType,
      fieldsExtracted: extraction.fields_extracted,
      fieldsExpected: extraction.fields_expected,
      people: extraction.people.length,
    });

    return { file_path: filePath, extraction, raw_text: rawText, ocr_succeeded: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown OCR error';
    logger.error('Company document OCR failed - storing for manual review', {
      businessSessionId: input.businessSessionId,
      documentType: input.documentType,
      error: message,
    });

    return {
      file_path: filePath,
      raw_text: '',
      ocr_succeeded: false,
      ocr_error: message,
      extraction: {
        fields: {},
        confidence: {},
        people: [],
        fields_expected: 0,
        fields_extracted: 0,
        overall_confidence: null,
        warnings: [`OCR failed: ${message}. Document stored for manual review.`],
      },
    };
  }
}
