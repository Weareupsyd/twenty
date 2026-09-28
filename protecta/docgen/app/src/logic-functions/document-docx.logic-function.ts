import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { DOCX_VIEW } from 'src/constants/universal-identifiers';
import {
  base64Of,
  loadGeneratedDocument,
  requireContent,
} from 'src/lib/doc-pages';
import { renderDocx } from 'src/lib/docx';
import { htmlResponse, renderDocPage } from 'src/lib/http';
import { CoreDbClient } from 'src/lib/records';

const HANDLER_NOTE =
  'Route responses are string-only, so the Word file is delivered as a base64 data URL download.';

/**
 * The .docx download page. Word files cannot be inlined, so the page
 * auto-downloads the document via a data URL and shows a manual link.
 */
const handler = async (event: RoutePayload): Promise<Response> => {
  const db = new CoreDbClient();
  const document = await loadGeneratedDocument(db, event);
  const problem = requireContent(document);
  if (problem) return htmlResponse(problem, document ? 422 : 404);
  const docx = await renderDocx(String(document!.content));
  const reference = String(document!.reference);
  const dataUrl = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${base64Of(docx)}`;
  const fileName = `document-${reference}.docx`;
  const pdfHref = `/s/docgen/documents/view?ref=${encodeURIComponent(reference)}`;
  return htmlResponse(
    renderDocPage({
      title: `Word copy ${reference}`,
      heading: `Word copy ${reference}`,
      bodyHtml: `
<p class="note">Policy ${String(document!.policyNo ?? '')} · <a href="${pdfHref}">Back to the PDF</a></p>
<p>Your Word document should download automatically. If not, use the button below.</p>
<p><a href="${dataUrl}" download="${fileName}">Download ${fileName}</a></p>
<a id="auto" href="${dataUrl}" download="${fileName}" style="display:none"></a>
<script>document.getElementById('auto').click();</script>
<p class="note">${HANDLER_NOTE}</p>`,
    }),
  );
};

export default defineLogicFunction({
  universalIdentifier: DOCX_VIEW,
  name: 'document-docx',
  description: 'Serves a generated document as an editable Word file.',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/docgen/documents/docx',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
