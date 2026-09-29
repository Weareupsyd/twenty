import { emailConfigFromEnv, sendEmail, type EmailConfig } from 'src/lib/email';
import { escapeHtml, publicBaseUrl } from 'src/lib/http';
import { renderPdf } from 'src/lib/policy-document/render-pdf';
import { generatePolicyPdf } from 'src/lib/policy-pdf';
import { type DbClient, type RecordData } from 'src/lib/records';
import { findPersonByPhone, findQuoteByRef, personPrimaryEmail } from 'src/lib/service-quotes';
import {
  whatsAppDocSender,
  type OutboundWhatsAppDocument,
  type WhatsAppDocSender,
} from 'src/lib/whatsapp-transport';

/**
 * Final policy delivery: once a policy exists (payment confirmed), build the
 * full "Motor Protecta Bode Policy" document from the Liberty template
 * (Protecta bode Final.docx, rendered by the Document Generator app) and
 * send it to the buyer on WhatsApp and by email.
 *
 * The Document Generator fills the template on `insurancePolicy.created`.
 * We wait for that record; if it never appears we ask it to generate one;
 * if the Document Generator is not installed we fall back to the Protecta
 * certificate PDF so the buyer always receives something.
 */

type Sleep = (ms: number) => Promise<void>;
const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DOC_FIELDS = ['reference', 'status', 'content', 'error', 'policyNo'];

const latestDocument = async (
  db: DbClient,
  policyNo: string,
): Promise<RecordData | null> => {
  const rows = await db.findMany(
    'generatedDocuments',
    {
      filter: { policyNo: { eq: policyNo } },
      orderBy: [{ createdAt: 'DescNullsLast' }],
      first: 5,
    },
    DOC_FIELDS,
  );
  return (
    rows.find(
      (row) => String(row.status) === 'GENERATED' && String(row.content ?? '').trim(),
    ) ??
    rows[0] ??
    null
  );
};

const isReady = (doc: RecordData | null): boolean =>
  Boolean(doc && String(doc.status) === 'GENERATED' && String(doc.content ?? '').trim());

/** Returns the generated template content, or null when the Document Generator is unavailable. */
export const waitForPolicyDocument = async (
  db: DbClient,
  policyNo: string,
  options: { attempts?: number; intervalMs?: number; sleep?: Sleep } = {},
): Promise<RecordData | null> => {
  const attempts = options.attempts ?? 8;
  const intervalMs = options.intervalMs ?? 2500;
  const sleep = options.sleep ?? defaultSleep;
  let requested = false;
  for (let i = 0; i < attempts; i++) {
    let doc: RecordData | null;
    try {
      doc = await latestDocument(db, policyNo);
    } catch (error) {
      // generatedDocument object missing: Document Generator not installed.
      console.warn('policy delivery: document generator unavailable', error);
      return null;
    }
    if (isReady(doc)) return doc;
    if (doc && String(doc.status) === 'FAILED') {
      console.error('policy delivery: document generation failed', doc.error);
      return null;
    }
    // Halfway through with nothing created, ask the generator directly.
    if (!doc && !requested && i >= Math.floor(attempts / 2)) {
      requested = true;
      try {
        await db.create('generatedDocument', {
          reference: '',
          kind: 'POLICY_CERTIFICATE',
          policyNo,
          status: 'PENDING',
          content: '',
          error: '',
        });
      } catch (error) {
        console.warn('policy delivery: could not request a document', error);
        return null;
      }
    }
    await sleep(intervalMs);
  }
  return null;
};

export type PolicyFile = OutboundWhatsAppDocument & { source: 'template' | 'certificate' };

export const buildPolicyFile = async (
  policy: RecordData,
  quote: RecordData | null,
  document: RecordData | null,
): Promise<PolicyFile> => {
  const policyNo = String(policy.policyNo ?? '');
  const safeNo = policyNo.replace(/[^A-Za-z0-9-]/g, '');
  const caption =
    `Protecta Bode policy ${policyNo} is active. Attached is your Motor Protecta Bode ` +
    `Policy from Liberty General Insurance Uganda. Keep it safe.`;
  if (document) {
    const bytes = await renderPdf(String(document.content), {
      footerLeft: `Policy ${policyNo} · Document ${String(document.reference ?? '')}`,
    });
    return {
      fileName: `Protecta-Bode-Policy-${safeNo}.pdf`,
      caption,
      base64: Buffer.from(bytes).toString('base64'),
      mimeType: 'application/pdf',
      source: 'template',
    };
  }
  const bytes = await generatePolicyPdf(policy, quote);
  return {
    fileName: `Protecta-Bode-Certificate-${safeNo}.pdf`,
    caption,
    base64: Buffer.from(bytes).toString('base64'),
    mimeType: 'application/pdf',
    source: 'certificate',
  };
};

export type DeliveryResult = {
  policyNo: string;
  source: PolicyFile['source'];
  whatsapp: 'sent' | 'skipped' | 'failed';
  email: 'sent' | 'skipped' | 'failed';
  errors: string[];
};

const policyEmailHtml = (policy: RecordData, name: string, viewUrl: string): string => `
<div style="font-family:Arial,sans-serif;color:#000;line-height:1.5">
  <p>Dear ${escapeHtml(name || 'customer')},</p>
  <p>Your payment has been received and your Protecta Bode motor policy
  <b>${escapeHtml(String(policy.policyNo ?? ''))}</b> is now active.</p>
  <p>Vehicle: ${escapeHtml(String(policy.plate ?? ''))}<br>
  Cover: ${escapeHtml(String(policy.periodStart ?? ''))} to ${escapeHtml(String(policy.periodEnd ?? ''))}</p>
  <p>Your policy document is attached. You can also view it online:
  <a href="${escapeHtml(viewUrl)}">${escapeHtml(viewUrl)}</a></p>
  <p>Protecta Bode · underwritten by Liberty General Insurance Uganda</p>
</div>`;

export const deliverPolicyDocument = async (
  db: DbClient,
  policyNo: string,
  deps: {
    sendDocument?: WhatsAppDocSender | null;
    email?: EmailConfig | null;
    sendEmailFn?: typeof sendEmail;
    sleep?: Sleep;
    attempts?: number;
  } = {},
): Promise<DeliveryResult | null> => {
  const policy = await db.findFirst(
    'insurancePolicies',
    { policyNo: { eq: policyNo } },
    ['policyNo', 'status', 'plate', 'vehicleMake', 'vehicleModel', 'premiumUgx', 'periodStart', 'periodEnd', 'quoteRef'],
  );
  if (!policy) return null;
  const quote = policy.quoteRef ? await findQuoteByRef(db, String(policy.quoteRef)) : null;
  const phone = String(quote?.policyholderPhone ?? '').trim();
  const person = phone ? await findPersonByPhone(db, phone).catch(() => null) : null;
  const emailTo = person ? personPrimaryEmail(person) : '';
  const nameRaw = person?.name as { firstName?: string; lastName?: string } | string | undefined;
  const name =
    typeof nameRaw === 'string'
      ? nameRaw
      : `${nameRaw?.firstName ?? ''} ${nameRaw?.lastName ?? ''}`.trim();

  const document = await waitForPolicyDocument(db, policyNo, {
    sleep: deps.sleep,
    attempts: deps.attempts,
  });
  const file = await buildPolicyFile(policy, quote, document);
  const base = publicBaseUrl();
  const viewUrl = document
    ? `${base}/s/docgen/documents/view?ref=${encodeURIComponent(String(document.reference))}`
    : `${base}/s/protecta/policies/doc?ref=${encodeURIComponent(policyNo)}`;

  const result: DeliveryResult = {
    policyNo,
    source: file.source,
    whatsapp: 'skipped',
    email: 'skipped',
    errors: [],
  };

  const sendDocument =
    deps.sendDocument !== undefined ? deps.sendDocument : await whatsAppDocSender();
  if (phone && sendDocument) {
    try {
      await sendDocument(phone, { ...file, caption: `${file.caption} ${viewUrl}` });
      result.whatsapp = 'sent';
    } catch (error) {
      result.whatsapp = 'failed';
      result.errors.push(`whatsapp: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const email = deps.email !== undefined ? deps.email : emailConfigFromEnv();
  if (emailTo && email) {
    try {
      await (deps.sendEmailFn ?? sendEmail)(email, {
        to: emailTo,
        subject: `Your Protecta Bode policy ${policyNo}`,
        html: policyEmailHtml(policy, name, viewUrl),
        idempotencyKey: `policy-doc-${policyNo}`,
        attachments: [{ filename: file.fileName, content: file.base64 }],
      });
      result.email = 'sent';
    } catch (error) {
      result.email = 'failed';
      result.errors.push(`email: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
};
