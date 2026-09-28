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
import {
  parseStructuredText,
  structuredTextToHtml,
} from 'src/lib/structured-text';

const DOCUMENT_STYLES = `
<style>
.doc{background:#fff;border-radius:8px;padding:28px 32px;box-shadow:0 1px 3px rgba(0,0,0,.08);
     font-size:14px;line-height:1.55;color:#111827}
.doc h2{font-size:20px;margin:20px 0 8px;color:#0b1f3f;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
.doc h3{font-size:16px;margin:16px 0 6px;color:#0b1f3f}
.doc h4{font-size:14px;margin:14px 0 6px;color:#1f2937}
.doc p{margin:0 0 8px}
.doc ul{margin:0 0 10px;padding-left:22px}
.doc li{margin:0 0 4px}
.doc table{border-collapse:collapse;width:100%;margin:0 0 14px;font-size:13px}
.doc th,.doc td{border:1px solid #d1d5db;padding:6px 8px;text-align:left;vertical-align:top}
.doc th{background:#eef2f7;font-weight:600}
</style>`;

/**
 * Route responses are string-only, so the PDF is embedded as a base64
 * data URL with an explicit download link. Text documents are rendered as
 * the styled document itself (printable from the browser); HTML-format
 * documents are served verbatim; pass ?asPdf=1 for the PDF instead.
 */
const handler = async (event: RoutePayload): Promise<Response> => {
  const db = new CoreDbClient();
  const document = await loadGeneratedDocument(db, event);
  const problem = requireContent(document);
  if (problem) return htmlResponse(problem, document ? 422 : 404);
  const reference = String(document!.reference);
  const content = String(document!.content);
  const policyNo = String(document!.policyNo ?? '');
  const isHtml = String(document!.format ?? 'TEXT').toUpperCase() === 'HTML';
  const wantsPdf = (event.queryStringParameters?.asPdf ?? '') === '1';
  const docxHref = `/s/docgen/documents/docx?ref=${encodeURIComponent(reference)}`;
  const pdfHref = `/s/docgen/documents/view?ref=${encodeURIComponent(reference)}&asPdf=1`;
  const footer = `Policy ${policyNo} · Document ${reference}`;

  if (isHtml && !wantsPdf) {
    return htmlResponse(
      renderDocPage({
        title: `Document ${reference}`,
        heading: `Document ${reference}`,
        bodyHtml: `
<p class="note">Policy ${policyNo} ·
<a href="${pdfHref}">Download PDF (plain layout)</a> ·
<a href="${docxHref}">Download Word copy</a> ·
<a href="javascript:window.print()">Print / Save as PDF</a></p>
${DOCUMENT_STYLES}
<div class="doc">${content}</div>`,
      }),
    );
  }

  if (!isHtml && !wantsPdf) {
    // Text templates (the policy document) keep their structure: headings,
    // numbered clauses, lists and the schedule tables.
    return htmlResponse(
      renderDocPage({
        title: `Policy ${policyNo} · Document ${reference}`,
        heading: `Policy document ${reference}`,
        bodyHtml: `
<p class="note">Policy ${policyNo} ·
<a href="${pdfHref}">Download PDF</a> ·
<a href="${docxHref}">Download Word copy</a> ·
<a href="javascript:window.print()">Print / Save as PDF</a></p>
${DOCUMENT_STYLES}
<article class="doc">${structuredTextToHtml(parseStructuredText(content))}</article>`,
      }),
    );
  }

  const pdfSource = isHtml ? htmlToText(content) : content;
  const pdf = await renderPdf(pdfSource, { footerLeft: footer });
  const dataUrl = `data:application/pdf;base64,${base64Of(pdf)}`;
  return htmlResponse(
    renderDocPage({
      title: `Policy document ${reference}`,
      heading: `Policy document ${reference}`,
      bodyHtml: `
<p class="note">Policy ${policyNo} · <a href="${docxHref}">Download Word copy</a> · <a href="${dataUrl}" download="document-${reference}.pdf">Download PDF</a></p>
<embed src="${dataUrl}" type="application/pdf" style="width:100%;height:80vh;border:0;border-radius:8px;background:#fff">
<p class="note">If the preview does not open in your browser, use the Download PDF link above.</p>`,
    }),
  );
};

export default defineLogicFunction({
  universalIdentifier: DOC_VIEW,
  name: 'document-view',
  description:
    'Renders a generated document: the policy document as a structured page, HTML templates as-is, and ?asPdf=1 as a PDF.',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/docgen/documents/view',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
