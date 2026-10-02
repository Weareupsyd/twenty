import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HTML_TO_PDF_URL, htmlToPdfUrl, renderHtmlToPdf } from 'src/lib/html-pdf';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('htmlToPdfUrl', () => {
  it('defaults to the shared Gotenberg container', () => {
    expect(htmlToPdfUrl({} as NodeJS.ProcessEnv)).toBe(DEFAULT_HTML_TO_PDF_URL);
  });
  it('prefers the app variable and accepts the DocGen one', () => {
    expect(htmlToPdfUrl({ HTML_TO_PDF_URL: 'http://r/app' } as NodeJS.ProcessEnv)).toBe(
      'http://r/app',
    );
    expect(htmlToPdfUrl({ PROTECTA_HTML_TO_PDF_URL: 'http://r/a' } as NodeJS.ProcessEnv)).toBe(
      'http://r/a',
    );
    expect(htmlToPdfUrl({ DOCGEN_HTML_TO_PDF_URL: 'http://r/b' } as NodeJS.ProcessEnv)).toBe(
      'http://r/b',
    );
  });

  it('prefers the app variable over the DocGen fallback when both are set', () => {
    expect(
      htmlToPdfUrl({
        HTML_TO_PDF_URL: 'http://r/app',
        DOCGEN_HTML_TO_PDF_URL: 'http://r/b',
      } as NodeJS.ProcessEnv),
    ).toBe('http://r/app');
  });
});

describe('renderHtmlToPdf', () => {
  it('submits the document as index.html with print layout', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nmock-pdf');
    const fetchMock = vi.fn(async () => new Response(bytes, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderHtmlToPdf('<html><body>invoice</body></html>');

    expect(result).toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(DEFAULT_HTML_TO_PDF_URL);
    const form = request.body as FormData;
    expect(form.get('emulatedMediaType')).toBe('print');
    expect(form.get('printBackground')).toBe('true');
    // Billing documents are sent, not phone-gated: no password field.
    expect(form.get('userPassword')).toBeNull();
    const file = form.get('files') as File;
    expect(file.name).toBe('index.html');
    expect(await file.text()).toContain('<body>invoice</body>');
  });

  it('rejects responses that are not PDFs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not a pdf', { status: 200 })),
    );
    await expect(renderHtmlToPdf('<html></html>')).rejects.toThrow(
      'did not return a valid PDF',
    );
  });

  it('surfaces renderer HTTP errors so callers can fall back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 503 })),
    );
    await expect(renderHtmlToPdf('<html></html>')).rejects.toThrow(
      'HTML-to-PDF renderer returned HTTP 503',
    );
  });
});
