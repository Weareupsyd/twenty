import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { GEN_ROUTE } from 'src/constants/universal-identifiers';
import { jsonResponse, parseJsonBody, str } from 'src/lib/http';
import { CoreDbClient } from 'src/lib/records';
import {
  DEFAULT_DOCUMENT_KIND,
  createGeneratedDocument,
  documentDocxUrl,
  documentPdfUrl,
} from 'src/lib/service-documents';

/** Manual/programmatic generation: POST { policyNo, kind? }. */
const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const body = parseJsonBody(event);
    const query = event.queryStringParameters ?? {};
    const policyNo = (str(body.policyNo) || str(query.policyNo)).trim();
    if (!policyNo) {
      return jsonResponse({ ok: false, error: 'policyNo is required.' }, 400);
    }
    const kind = (str(body.kind) || str(query.kind) || DEFAULT_DOCUMENT_KIND).trim();
    const db = new CoreDbClient();
    const document = await createGeneratedDocument(db, { policyNo, kind });
    const reference = String(document.reference);
    const base = process.env.PUBLIC_BASE_URL ?? '';
    return jsonResponse(
      {
        ok: document.status === 'GENERATED',
        reference,
        policyNo,
        status: document.status,
        error: document.error || undefined,
        pdfUrl: documentPdfUrl(base, reference),
        docxUrl: documentDocxUrl(base, reference),
      },
      document.status === 'GENERATED' ? 201 : 422,
    );
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'Failed.' },
      400,
    );
  }
};

export default defineLogicFunction({
  universalIdentifier: GEN_ROUTE,
  name: 'generate-document',
  description:
    'Generates a document for a policy on demand (POST { policyNo, kind? }).',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/docgen/generate',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
});
