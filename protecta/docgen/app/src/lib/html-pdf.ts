const PDF_SIGNATURE = '%PDF-';

/**
 * Render an HTML document with a configured Chromium-backed PDF service.
 * The HTML template is submitted as index.html so its embedded Word styles,
 * @page rules, page breaks and tables are rendered by an actual browser engine.
 */
export const renderHtmlToPdf = async (
  html: string,
  userPassword: string,
): Promise<Uint8Array> => {
  const rendererUrl = process.env.DOCGEN_HTML_TO_PDF_URL?.trim();

  if (!userPassword.trim()) {
    throw new Error('A phone-number PDF password is required.');
  }

  if (!rendererUrl) {
    throw new Error(
      'DOCGEN_HTML_TO_PDF_URL is required to render the Protecta HTML policy template.',
    );
  }

  const form = new FormData();
  form.append(
    'files',
    new Blob([html], { type: 'text/html; charset=utf-8' }),
    'index.html',
  );
  form.append('emulatedMediaType', 'print');
  form.append('printBackground', 'true');
  form.append('preferCssPageSize', 'true');
  // Gotenberg makes this the PDF's user/open password. Its owner password
  // defaults to the same value when none is supplied.
  form.append('userPassword', userPassword);

  const response = await fetch(rendererUrl, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    throw new Error(`HTML-to-PDF renderer returned HTTP ${response.status}.`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const signature = new TextDecoder().decode(bytes.subarray(0, PDF_SIGNATURE.length));

  if (signature !== PDF_SIGNATURE) {
    throw new Error('HTML-to-PDF renderer did not return a valid PDF.');
  }

  return bytes;
};
