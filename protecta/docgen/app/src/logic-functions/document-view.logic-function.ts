import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { DOC_VIEW } from 'src/constants/universal-identifiers';
import {
  base64Of,
  loadGeneratedDocument,
  requireContent,
} from 'src/lib/doc-pages';
import { htmlResponse, renderDocPage } from 'src/lib/http';
import { renderPdf } from 'src/lib/pdf';
import { CoreDbClient } from 'src/lib/records';

/**
 * Route responses are string-only, so the PDF is embedded as a base64
 * data URL with an explicit download link.
 */
const handler = async (event: RoutePayload): Promise<Response> => {
  const db = new CoreDbClient();
  const document = await loadGeneratedDocument(db, event);
  const problem = requireContent(document);
  if (problem) return htmlResponse(problem, document ? 422 : 404);
  const pdf = await renderPdf(String(document!.content));
  const dataUrl = `data:application/pdf;base64,${base64Of(pdf)}`;
  const docxHref = `/s/docgen/documents/docx?ref=${encodeURIComponent(
    String(document!.reference),
  )}`;
  return htmlResponse(
    renderDocPage({
      title: `Policy document ${String(document!.reference)}`,
      heading: `Policy document ${String(document!.reference)}`,
      bodyHtml: `
<p class="note">Policy ${String(document!.policyNo ?? '')} · <a href="${docxHref}">Download Word copy</a> · <a href="${dataUrl}" download="document-${String(document!.reference)}.pdf">Download PDF</a></p>
<embed src="${dataUrl}" type="application/pdf" style="width:100%;height:80vh;border:0;border-radius:8px;background:#fff">
<p class="note">If the preview does not open in your browser, use the Download PDF link above.</p>`,
    }),
  );
};

export default defineLogicFunction({
  universalIdentifier: DOC_VIEW,
  name: 'document-view',
  description: 'Renders a generated document as a PDF (view/download page).',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/docgen/documents/view',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
