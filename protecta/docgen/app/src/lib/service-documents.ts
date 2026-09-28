import { assembleDocumentData, renderTemplate } from 'src/lib/render';
import { type DbClient, type RecordData } from 'src/lib/records';
import { findTemplateBody } from 'src/lib/templates';

export const DEFAULT_DOCUMENT_KIND = 'POLICY_CERTIFICATE';

const digits = (
  length: number,
  rng: () => number = () => Math.random(),
): string => {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += String(Math.floor(rng() * 10));
  }
  return out;
};

/** Document reference shown to customers, e.g. DOC-004213. */
export const makeDocRef = (rng?: () => number): string => `DOC-${digits(6, rng)}`;

export const documentPdfUrl = (baseUrl: string, reference: string): string =>
  `${baseUrl.replace(/\/$/, '')}/s/docgen/documents/view?ref=${encodeURIComponent(reference)}`;

export const documentDocxUrl = (baseUrl: string, reference: string): string =>
  `${baseUrl.replace(/\/$/, '')}/s/docgen/documents/docx?ref=${encodeURIComponent(reference)}`;

const setReferenceWithRetry = async (
  db: DbClient,
  record: RecordData,
  makeRef: () => string,
  maxAttempts: number,
): Promise<RecordData> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await db.update('generatedDocument', String(record.id), {
        reference: makeRef(),
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

/**
 * Fill a generated document record that is still empty: draw its
 * reference (DOC-XXXXXX), render the template against the Protecta
 * policy data and stamp the status. Records that already carry content
 * (for example filled right after creation) are left untouched.
 */
export const fillGeneratedDocument = async (
  db: DbClient,
  record: RecordData,
  options: { makeRef?: () => string; maxRefAttempts?: number } = {},
): Promise<RecordData> => {
  const hasContent =
    typeof record.content === 'string' && record.content.trim().length > 0;
  if (hasContent) return record;

  const makeRef = options.makeRef ?? (() => makeDocRef());

  let current = record;
  if (!String(current.reference ?? '').trim()) {
    current = await setReferenceWithRetry(
      db,
      current,
      makeRef,
      options.maxRefAttempts ?? 3,
    );
  }

  const reference = String(current.reference ?? '');
  const policyNo = String(current.policyNo ?? '').trim();
  const kind = String(current.kind ?? '') || DEFAULT_DOCUMENT_KIND;
  const body = await findTemplateBody(db, kind);
  const { data, error } = await assembleDocumentData(db, {
    policyNo,
    reference,
  });

  if (!data) {
    return db.update('generatedDocument', String(current.id), {
      status: 'FAILED',
      error: error ?? 'Unknown error.',
      generatedAt: new Date().toISOString(),
    });
  }

  return db.update('generatedDocument', String(current.id), {
    content: renderTemplate(body, data),
    status: 'GENERATED',
    error: '',
    generatedAt: new Date().toISOString(),
  });
};

/**
 * Create a generated document for a Protecta policy and fill it in the
 * same call. Used by the automatic `insurancePolicy.created` trigger and
 * by the manual generate route.
 */
export const createGeneratedDocument = async (
  db: DbClient,
  input: {
    policyNo: string;
    kind?: string;
    makeRef?: () => string;
    maxRefAttempts?: number;
  },
): Promise<RecordData> => {
  const created = await db.create('generatedDocument', {
    reference: '',
    kind: input.kind || DEFAULT_DOCUMENT_KIND,
    policyNo: input.policyNo,
    status: 'PENDING',
    content: '',
    error: '',
  });
  return fillGeneratedDocument(db, created, input);
};

export const findGeneratedDocumentByRef = (
  db: DbClient,
  reference: string,
): Promise<RecordData | null> =>
  db.findFirst(
    'generatedDocuments',
    { reference: { eq: reference } },
    ['reference', 'kind', 'policyNo', 'status', 'content', 'error', 'generatedAt'],
  );

export const findLatestGeneratedDocument = (
  db: DbClient,
  policyNo: string,
): Promise<RecordData | null> =>
  db.findFirst(
    'generatedDocuments',
    { policyNo: { eq: policyNo }, status: { eq: 'GENERATED' } },
    ['reference', 'kind', 'policyNo', 'status', 'content', 'error', 'generatedAt'],
  );
