import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoutePayload } from 'twenty-sdk/define';
import { PDFDocument } from 'pdf-lib';

vi.mock('src/lib/html-pdf', () => ({
  renderHtmlToPdf: vi.fn(),
}));

vi.mock('src/lib/records', async (importOriginal) => {
  const actual = await importOriginal<typeof import('src/lib/records')>();
  const shared = new actual.MemoryDbClient();
  class FakeCoreDbClient {
    static shared = shared;
    findFirst(...args: Parameters<typeof shared.findFirst>) {
      return shared.findFirst(...args);
    }
    findMany(...args: Parameters<typeof shared.findMany>) {
      return shared.findMany(...args);
    }
    create(...args: Parameters<typeof shared.create>) {
      return shared.create(...args);
    }
    update(...args: Parameters<typeof shared.update>) {
      return shared.update(...args);
    }
  }
  return { ...actual, CoreDbClient: FakeCoreDbClient };
});

import { CoreDbClient, type MemoryDbClient } from 'src/lib/records';
import { renderHtmlToPdf } from 'src/lib/html-pdf';
import { createGeneratedDocument } from 'src/lib/service-documents';
import documentView from 'src/logic-functions/document-view.logic-function';
import documentVerify from 'src/logic-functions/document-verify.logic-function';

type RouteHandler = (
  payload: RoutePayload,
) => Promise<{ body: unknown; status?: number }>;
const handle = documentView.config.handler as unknown as RouteHandler;
const handleVerify = documentVerify.config.handler as unknown as RouteHandler;
const workspace = (
  CoreDbClient as unknown as { shared: MemoryDbClient }
).shared;

const event = (query: Record<string, string> = {}): RoutePayload =>
  ({ queryStringParameters: query }) as unknown as RoutePayload;

const seedGeneratedPolicy = async () => {
  const person = await workspace.create('person', {
    name: { firstName: 'Sarah', lastName: 'Kato' },
    protectaPhone: '+256772000000',
    protectaAddress: 'Plot 12, Kampala Road, Kampala',
    protectaOccupation: 'Transport and logistics',
  });
  await workspace.create('insuranceQuote', {
    reference: 'QUOTE-1',
    policyholderId: person.id,
    policyholderPhone: '+256772000000',
    vehicleValue: 10_000_000,
    createdAt: '2026-09-20T09:00:00.000Z',
  });
  await workspace.create('insurancePolicy', {
    policyNo: 'PB-2026-004213',
    status: 'ACTIVE',
    plate: 'UAX 123C',
    vehicleMake: 'Toyota',
    vehicleModel: 'Premio',
    premiumUgx: 150_000,
    periodStart: '2026-09-28',
    periodEnd: '2027-09-28',
    quoteRef: 'QUOTE-1',
  });
  return createGeneratedDocument(workspace, {
    policyNo: 'PB-2026-004213',
    makeRef: () => 'DOC-000001',
  });
};

describe('policy document PDF download route', () => {
  beforeEach(() => {
    vi.mocked(renderHtmlToPdf).mockReset();
    for (const key of Object.keys(workspace.store)) {
      delete workspace.store[key];
    }
  });

  it('requires the purchaser phone without revealing it or the policy wording', async () => {
    await seedGeneratedPolicy();

    const response = await handle(event({ ref: 'DOC-000001', asPdf: '1' }));
    const html = String(response.body);

    expect(response.status).toBe(200);
    expect(html).toContain('Verify phone &amp; download full policy PDF');
    expect(html).toContain('name="phone"');
    expect(html).toContain('action="/s/docgen/documents/verify"');
    expect(html).not.toContain('+256772000000');
    expect(html).not.toContain('PREMIUM PAYMENT WARRANTY');
    expect(html.match(/<button\b/g)).toHaveLength(1);
  });

  it('accepts the policyNo landing link and creates the document if needed', async () => {
    await seedGeneratedPolicy();
    delete workspace.store.generatedDocuments;

    const response = await handle(
      event({ policyNo: 'PB-2026-004213', asPdf: '1' }),
    );
    const html = String(response.body);

    expect(response.status).toBe(200);
    expect(html).toContain('Verify phone &amp; download full policy PDF');
    expect(workspace.store.generatedDocuments).toHaveLength(1);
    expect(workspace.store.generatedDocuments[0]).toMatchObject({
      policyNo: 'PB-2026-004213',
      status: 'GENERATED',
    });
  });

  it('rejects a wrong phone number', async () => {
    await seedGeneratedPolicy();

    const response = await handle(
      event({ ref: 'DOC-000001', asPdf: '1', phone: '0701000000' }),
    );

    expect(response.status).toBe(403);
    expect(String(response.body)).toContain('did not match');
    expect(String(response.body)).not.toContain('+256772000000');
  });

  it('downloads the multi-page policy PDF as one action after verification', async () => {
    await seedGeneratedPolicy();
    const pdfDocument = await PDFDocument.create();
    pdfDocument.addPage();
    pdfDocument.addPage();
    vi.mocked(renderHtmlToPdf).mockResolvedValue(await pdfDocument.save());

    const response = await handleVerify(
      {
        body: 'ref=DOC-000001&asPdf=1&phone=0772000000',
        queryStringParameters: {},
      } as unknown as RoutePayload,
    );
    const html = String(response.body);
    const pdfBase64 = html.match(
      /href="data:application\/pdf;base64,([A-Za-z0-9+/=]+)" download=/,
    )?.[1];

    expect(response.status).toBe(200);
    expect(html).toContain('Download full policy PDF');
    expect(renderHtmlToPdf).toHaveBeenCalledOnce();
    expect(vi.mocked(renderHtmlToPdf).mock.calls[0][1]).toBe('0772000000');
    expect(String(vi.mocked(renderHtmlToPdf).mock.calls[0][0])).toContain('Sarah Kato');
    expect(String(vi.mocked(renderHtmlToPdf).mock.calls[0][0])).not.toContain('image001.png');
    expect(html).not.toContain('Download Word copy');
    expect(html).not.toContain('Print / Save as PDF');
    expect(html).not.toContain('<embed');
    expect(html.match(/<a\b/g)).toHaveLength(1);
    expect(pdfBase64).toBeTruthy();

    const pdf = await PDFDocument.load(Buffer.from(pdfBase64!, 'base64'));
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });
});
