const PDF_SIGNATURE = '%PDF-';

/** Default Chromium endpoint; the same Gotenberg container the DocGen app renders
 * policy documents with (docker compose --profile docgen-renderer). */
export const DEFAULT_HTML_TO_PDF_URL =
  'http://gotenberg:3000/forms/chromium/convert/html';

/** The configured Chromium-backed renderer, if any. */
export const htmlToPdfUrl = (env: NodeJS.ProcessEnv = process.env): string =>
  (env.PROTECTA_HTML_TO_PDF_URL ?? env.DOCGEN_HTML_TO_PDF_URL ?? '').trim() ||
  DEFAULT_HTML_TO_PDF_URL;

/**
 * Render a billing document (invoice, receipt) with the configured Chromium
 * service so the HTML template's own CSS — tables, rules, the flag, the logo —
 * is what reaches the customer. Throws when the renderer is unreachable or
 * returns something that is not a PDF; callers fall back to a drawn PDF so a
 * missing renderer never blocks a WhatsApp send.
 */
export const renderHtmlToPdf = async (
  html: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Uint8Array> => {
  const rendererUrl = htmlToPdfUrl(env);

  const form = new FormData();
  form.append(
    'files',
    new Blob([html], { type: 'text/html; charset=utf-8' }),
    'index.html',
  );
  form.append('emulatedMediaType', 'print');
  form.append('printBackground', 'true');

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
