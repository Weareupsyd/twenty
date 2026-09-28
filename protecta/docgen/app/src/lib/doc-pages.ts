import { type RoutePayload } from 'twenty-sdk/define';
import { type DbClient, type RecordData } from 'src/lib/records';
import {
  findGeneratedDocumentByRef,
  findLatestGeneratedDocument,
} from 'src/lib/service-documents';
import { renderDocPage, str } from 'src/lib/http';

export const loadGeneratedDocument = async (
  db: DbClient,
  event: RoutePayload,
): Promise<RecordData | null> => {
  const query = event.queryStringParameters ?? {};
  const reference = str(query.ref).trim();
  const policyNo = str(query.policyNo).trim();
  if (reference) return findGeneratedDocumentByRef(db, reference);
  if (policyNo) return findLatestGeneratedDocument(db, policyNo);
  return null;
};

export const documentErrorPage = (message: string): string =>
  renderDocPage({
    title: 'Document not available',
    heading: 'Document not available',
    bodyHtml: `<p class="note">${message}</p>`,
  });

export const requireContent = (
  document: RecordData | null,
): string | null => {
  if (!document) {
    return documentErrorPage('Provide ?ref=<document ref> or ?policyNo=<policy no>.');
  }
  const content = typeof document.content === 'string' ? document.content : '';
  if (String(document.status ?? '') !== 'GENERATED' || !content.trim()) {
    return documentErrorPage(
      `Document ${String(document.reference ?? '')} is ${String(
        document.status ?? 'PENDING',
      ).toLowerCase()}${document.error ? `: ${String(document.error)}` : '.'}`,
    );
  }
  return null;
};

export const base64Of = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64');
