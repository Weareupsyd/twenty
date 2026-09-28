import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { DOC_VIEW } from 'src/constants/universal-identifiers';
import {
  base64Of,
  loadGeneratedDocument,
  requireContent,
} from 'src/lib/doc-pages';
import { htmlToText } from 'src/lib/html';
import { htmlResponse, renderDocPage } from 'src/lib/http';
import { renderPdf } from 'src/lib/pdf';
import { CoreDbClient } from 'src/lib/records';

/**
 * Route responses are string-only, so the PDF is embedded as a base64
 * data URL with an explicit download link. HTML-format documents are
 * served as the styled HTML document itself (printable from the
 * browser); pass ?asPdf=1 for the plain text-layout PDF instead.
 */
const handler = async (event: RoutePayload): Promise<Response> => {
  const db = new CoreDbClient();
  const document = await loadGeneratedDocument(db, event);
  const problem = requireContent(document);
  if (problem) return htmlResponse(problem, document ? 422 : 404);
  const reference = String(document!.reference);
  const content = String(document!.content);
  const isHtml = String(document!.format ?? 'TEXT').toUpperCase() === 'HTML';
  const wantsPdf = (event.queryStringParameters?.asPdf ?? '') === '1';
  const docxHref = `/s/docgen/documents/docx?ref=${encodeURIComponent(reference)}`;

  if (isHtml && !wantsPdf) {
    return htmlResponse(
      renderDocPage({
        title: `Document ${reference}`,
        heading: `Document ${reference}`,
        bodyHtml: `
<p class="note">Policy ${String(document!.policyNo ?? '')} ·
<a href="/s/docgen/documents/view?ref=${encodeURIComponent(reference)}&asPdf=1">Download PDF (plain layout)</a> ·
<a href="${docxHref}">Download Word copy</a> ·
<a href="javascript:window.print()">Print / Save as PDF</a></p>
<div style="background:#fff;border-radius:8px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)">${content}</div>`,
      }),
    );
  }

  const pdfSource = isHtml ? htmlToText(content) : content;
  const pdf = await renderPdf(pdfSource);
  const dataUrl = `data:application/pdf;base64,${base64Of(pdf)}`;
  return htmlResponse(
    renderDocPage({
      title: `Policy document ${reference}`,
      heading: `Policy document ${reference}`,
      bodyHtml: `
<p class="note">Policy ${String(document!.policyNo ?? '')} · <a href="${docxHref}">Download Word copy</a> · <a href="${dataUrl}" download="document-${reference}.pdf">Download PDF</a></p>
<embed src="${dataUrl}" type="application/pdf" style="width:100%;height:80vh;border:0;border-radius:8px;background:#fff">
<p class="note">If the preview does not open in your browser, use the Download PDF link above.</p>`,
    }),
  );
};

export default defineLogicFunction({
  universalIdentifier: DOC_VIEW,
  name: 'document-view',
  description:
    'Renders a generated document: HTML documents as a printable page, others as a PDF.',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/docgen/documents/view',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
