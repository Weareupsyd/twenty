/**
 * Test: POST /api/v2/ocr/extract - standalone OCR endpoint
 *
 * Verifies auth requirement, input validation, local-provider extraction,
 * response shape (stable aliases + validation summary) and raw_text gating.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockProcessDocument = vi.fn();

vi.mock('@/middleware/auth.js', () => ({
  authenticateAPIKey: (req: any, res: any, next: any) => {
    if (req.headers['x-api-key'] !== 'ik_testkey') {
      return res.status(401).json({ error: 'API key is required. Include X-API-Key header.' });
    }
    req.apiKey = { id: 'key-1', developer_id: 'dev-1' };
    req.developer = { id: 'dev-1' };
    next();
  },
}));

vi.mock('@/middleware/rateLimit.js', () => ({
  rateLimitMiddleware: (_req: any, _res: any, next: any) => next(),
  basicRateLimit: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/providers/ocr/index.js', () => ({
  createOCRProvider: () => ({
    name: 'paddle',
    processDocument: mockProcessDocument,
  }),
}));

vi.mock('@/services/engineClient.js', () => ({
  default: {
    isEnabled: () => false,
    extractOCR: vi.fn(),
  },
}));

vi.mock('@/config/database.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(() => ({ data: null, error: null })),
    })),
  },
  connectDB: vi.fn(),
}));

vi.mock('@/config/index.js', () => ({
  default: {
    encryptionKey: 'test-key-32-bytes-long-1234567890',
    apiKeySecret: 'test-api-key-secret',
  },
}));

vi.mock('@/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logError: vi.fn(),
}));

vi.mock('@kabila/shared', () => ({
  decryptSecret: vi.fn(() => 'decrypted'),
}));

const mockRenderPdf = vi.fn();
vi.mock('@/utils/pdfToImage.js', () => ({
  isPdfBuffer: (buf: Buffer) => buf.subarray(0, 5).toString('latin1') === '%PDF-',
  renderPdfPageToPng: (...args: any[]) => mockRenderPdf(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PDF = Buffer.from('%PDF-1.4 minimal test pdf');
const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function buildApp() {
  const { default: ocrRouter } = await import('../ocr.js');
  const { errorHandler } = await import('@/middleware/errorHandler.js');
  const express = await import('express');
  const request = (await import('supertest')).default;

  const app = express.default();
  app.use('/api/v2/ocr', ocrRouter);
  app.use(errorHandler);
  return { app, request };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Standalone OCR Endpoint', () => {
  beforeEach(() => {
    mockProcessDocument.mockReset();
    mockRenderPdf.mockReset();
    mockRenderPdf.mockResolvedValue({ png: FAKE_PNG, pageCount: 2, pageRendered: 1 });
    mockProcessDocument.mockResolvedValue({
      name: 'OKELLO JOHN',
      date_of_birth: '1990-04-12',
      document_number: 'CM900412100XYZ',
      nationality: 'UGA',
      sex: 'M',
      expiry_date: '2030-04-11',
      detected_document_type: 'national_id',
      raw_text: 'REPUBLIC OF UGANDA NATIONAL ID ...',
      confidence_scores: { name: 0.97, date_of_birth: 0.95, document_number: 0.99 },
    });
  });

  it('rejects requests without an API key', { timeout: 15000 }, async () => {
    const { app, request } = await buildApp();
    const res = await request(app)
      .post('/api/v2/ocr/extract')
      .attach('document', JPEG, { filename: 'id.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(401);
  });

  it('rejects requests without a file', async () => {
    const { app, request } = await buildApp();
    const res = await request(app)
      .post('/api/v2/ocr/extract')
      .set('X-API-Key', 'ik_testkey')
      .field('document_type', 'national_id');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/image file is required/i);
  });

  it('rejects unsupported mime types', async () => {
    const { app, request } = await buildApp();
    const res = await request(app)
      .post('/api/v2/ocr/extract')
      .set('X-API-Key', 'ik_testkey')
      .attach('document', Buffer.from('GIF89a...'), { filename: 'doc.gif', contentType: 'image/gif' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/unsupported file type/i);
  });

  it('accepts a PDF, renders the page and OCRs it', async () => {
    const { app, request } = await buildApp();
    const res = await request(app)
      .post('/api/v2/ocr/extract')
      .set('X-API-Key', 'ik_testkey')
      .field('document_type', 'national_id')
      .attach('document', PDF, { filename: 'scan.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.source_format).toBe('pdf');
    expect(res.body.pdf).toEqual({ page_rendered: 1, page_count: 2 });
    expect(res.body.data.full_name).toBe('OKELLO JOHN');
    // OCR ran on the rendered PNG, not the raw PDF bytes
    expect(mockRenderPdf).toHaveBeenCalledWith(expect.any(Buffer), 1);
    const ocrBuffer = mockProcessDocument.mock.calls[0][0] as Buffer;
    expect(ocrBuffer.equals(FAKE_PNG)).toBe(true);
  });

  it('renders the requested PDF page', async () => {
    mockRenderPdf.mockResolvedValue({ png: FAKE_PNG, pageCount: 3, pageRendered: 2 });
    const { app, request } = await buildApp();
    const res = await request(app)
      .post('/api/v2/ocr/extract')
      .set('X-API-Key', 'ik_testkey')
      .field('page', '2')
      .attach('document', PDF, { filename: 'scan.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(200);
    expect(mockRenderPdf).toHaveBeenCalledWith(expect.any(Buffer), 2);
    expect(res.body.pdf.page_rendered).toBe(2);
  });

  it('rejects an invalid PDF page value', async () => {
    const { app, request } = await buildApp();
    const res = await request(app)
      .post('/api/v2/ocr/extract')
      .set('X-API-Key', 'ik_testkey')
      .field('page', '0')
      .attach('document', PDF, { filename: 'scan.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/page/i);
  });

  it('returns 400 for a corrupted PDF', async () => {
    mockRenderPdf.mockRejectedValue(new Error('cannot recognize version marker'));
    const { app, request } = await buildApp();
    const res = await request(app)
      .post('/api/v2/ocr/extract')
      .set('X-API-Key', 'ik_testkey')
      .attach('document', PDF, { filename: 'broken.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/could not read pdf/i);
  });

  it('rejects invalid document_type', async () => {
    const { app, request } = await buildApp();
    const res = await request(app)
      .post('/api/v2/ocr/extract')
      .set('X-API-Key', 'ik_testkey')
      .field('document_type', 'voter_card')
      .attach('document', JPEG, { filename: 'id.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/document_type/i);
  });

  it('rejects invalid issuing_country', async () => {
    const { app, request } = await buildApp();
    const res = await request(app)
      .post('/api/v2/ocr/extract')
      .set('X-API-Key', 'ik_testkey')
      .field('issuing_country', 'UGANDA')
      .attach('document', JPEG, { filename: 'id.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/issuing_country/i);
  });

  it('extracts data and returns stable aliases + validation', async () => {
    const { app, request } = await buildApp();
    const res = await request(app)
      .post('/api/v2/ocr/extract')
      .set('X-API-Key', 'ik_testkey')
      .field('document_type', 'national_id')
      .field('issuing_country', 'ug')
      .attach('document', JPEG, { filename: 'id.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.provider).toBe('paddle');
    expect(res.body.source_format).toBe('image');
    expect(res.body.document_type).toBe('national_id');
    expect(res.body.issuing_country).toBe('UG');
    expect(res.body.data.full_name).toBe('OKELLO JOHN');
    expect(res.body.data.document_number).toBe('CM900412100XYZ');
    expect(res.body.data.nationality).toBe('UGA');
    expect(res.body.validation.is_valid).toBe(true);
    expect(res.body.raw_text).toBeUndefined();
    expect(typeof res.body.processing_ms).toBe('number');

    // Provider called with normalized inputs
    expect(mockProcessDocument).toHaveBeenCalledWith(
      expect.any(Buffer), 'national_id', 'UG', undefined,
    );
  });

  it('accepts "file" as an alternative field name', async () => {
    const { app, request } = await buildApp();
    const res = await request(app)
      .post('/api/v2/ocr/extract')
      .set('X-API-Key', 'ik_testkey')
      .attach('file', JPEG, { filename: 'id.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('includes raw_text only when requested', async () => {
    const { app, request } = await buildApp();
    const res = await request(app)
      .post('/api/v2/ocr/extract')
      .set('X-API-Key', 'ik_testkey')
      .field('include_raw_text', 'true')
      .attach('document', JPEG, { filename: 'id.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(res.body.raw_text).toMatch(/REPUBLIC OF UGANDA/);
  });

  it('flags missing critical fields in validation', async () => {
    mockProcessDocument.mockResolvedValue({
      nationality: 'UGA',
      confidence_scores: { nationality: 0.4 },
    });
    const { app, request } = await buildApp();
    const res = await request(app)
      .post('/api/v2/ocr/extract')
      .set('X-API-Key', 'ik_testkey')
      .attach('document', JPEG, { filename: 'id.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(res.body.validation.is_valid).toBe(false);
    expect(res.body.validation.errors.length).toBeGreaterThan(0);
    expect(res.body.validation.warnings).toContain('Low OCR confidence scores detected');
  });

  it('health probe reports mode and limits', async () => {
    const { app, request } = await buildApp();
    const res = await request(app)
      .get('/api/v2/ocr/health')
      .set('X-API-Key', 'ik_testkey');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('local');
    expect(res.body.supported_document_types).toContain('auto');
    expect(res.body.supported_formats).toContain('pdf');
  });
});
