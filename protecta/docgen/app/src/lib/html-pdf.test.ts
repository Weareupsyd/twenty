import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHtmlToPdf } from 'src/lib/html-pdf';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('renderHtmlToPdf', () => {
  it('submits the HTML and print-layout options to the configured renderer', async () => {
    vi.stubEnv(
      'DOCGEN_HTML_TO_PDF_URL',
      'http://gotenberg:3000/forms/chromium/convert/html',
    );
    const bytes = new TextEncoder().encode('%PDF-1.7\nmock-pdf');
    const fetchMock = vi.fn(async () => new Response(bytes, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderHtmlToPdf(
      '<html><body>policy</body></html>',
      '+256772000000',
    );

    expect(result).toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const form = request.body as FormData;
    expect(form.get('emulatedMediaType')).toBe('print');
    expect(form.get('printBackground')).toBe('true');
    expect(form.get('preferCssPageSize')).toBe('true');
    expect(form.get('userPassword')).toBe('+256772000000');
    const file = form.get('files') as File;
    expect(file.name).toBe('index.html');
    expect(await file.text()).toContain('<body>policy</body>');
  });

  it('fails clearly when no renderer is configured', async () => {
    vi.stubEnv('DOCGEN_HTML_TO_PDF_URL', '');
    await expect(renderHtmlToPdf('<html></html>', '0772000000')).rejects.toThrow(
      'DOCGEN_HTML_TO_PDF_URL is required',
    );
  });

  it('rejects responses that are not PDFs', async () => {
    vi.stubEnv('DOCGEN_HTML_TO_PDF_URL', 'http://gotenberg/convert');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not a pdf', { status: 200 })),
    );
    await expect(renderHtmlToPdf('<html></html>', '0772000000')).rejects.toThrow(
      'did not return a valid PDF',
    );
  });
});
