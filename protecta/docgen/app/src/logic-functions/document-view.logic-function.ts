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
import { renderHtmlToPdf } from 'src/lib/html-pdf';
import { renderPdf } from 'src/lib/pdf';
import { CoreDbClient, type DbClient } from 'src/lib/records';
import { createGeneratedDocument } from 'src/lib/service-documents';
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

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ] ?? char,
  );

const lastNineDigits = (value: string): string =>
  value.replace(/\D/g, '').slice(-9);

const requestBody = (event: RoutePayload): Record<string, unknown> => {
  if (event.body && typeof event.body === 'object') {
    return event.body as Record<string, unknown>;
  }

  const raw =
    typeof event.body === 'string'
      ? event.body
      : typeof event.rawBody === 'string'
        ? event.rawBody
        : '';

  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
};

const getPolicyholderPhone = async (
  db: DbClient,
  policyNo: string,
): Promise<string> => {
  const policy = await db.findFirst(
    'insurancePolicies',
    { policyNo: { eq: policyNo } },
    ['quoteRef'],
  );
  const quoteRef = String(policy?.quoteRef ?? '').trim();

  if (!quoteRef) {
    return '';
  }

  const quote = await db.findFirst(
    'insuranceQuotes',
    { reference: { eq: quoteRef } },
    ['policyholderPhone', 'policyholderId'],
  );
  const quotePhone = String(quote?.policyholderPhone ?? '').trim();

  if (quotePhone) {
    return quotePhone;
  }

  const personId = String(quote?.policyholderId ?? '').trim();

  if (!personId) {
    return '';
  }

  const person = await db.findFirst(
    'people',
    { id: { eq: personId } },
    ['protectaPhone'],
  );

  return String(person?.protectaPhone ?? '').trim();
};

const phoneEntryPage = (reference: string, error = ''): string =>
  renderDocPage({
    title: 'Phone verification · Protecta Bode policy',
    heading: 'Download your full policy PDF',
    bodyHtml: `
<p class="note">This is the complete Liberty Motor Protecta Bode policy document, including the filled-in policy schedule. Enter the phone number used when purchasing the policy to continue.</p>
${error ? `<p role="alert" style="color:#b42318">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/s/docgen/documents/verify" style="max-width:440px">
  <input type="hidden" name="ref" value="${escapeHtml(reference)}">
  <input type="hidden" name="asPdf" value="1">
  <label for="policy-phone" style="display:block;margin:12px 0 6px;font-weight:600">Phone number</label>
  <input id="policy-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="Enter phone number" style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:8px;font-size:16px">
  <button type="submit" style="margin-top:12px;padding:12px 18px;border:0;border-radius:8px;background:#0b1f3f;color:#fff;font-weight:700;font-size:15px;cursor:pointer">Verify phone &amp; download full policy PDF</button>
</form>`,
  });

const policyPdfDownloadPage = (
  policyNo: string,
  reference: string,
  pdf: Uint8Array,
): string => {
  const safePolicyNo = policyNo.replace(/[^A-Za-z0-9-]/g, '') || 'policy';
  const dataUrl = `data:application/pdf;base64,${base64Of(pdf)}`;
  const cleanUrl = `/s/docgen/documents/view?ref=${encodeURIComponent(reference)}&asPdf=1`;

  return renderDocPage({
    title: `Policy PDF · ${policyNo}`,
    heading: 'Your policy PDF is ready',
    bodyHtml: `
<p class="note">Your phone number was verified. This PDF contains the complete policy wording and schedule. To open it, use the exact phone number you entered as the PDF password.</p>
<a href="${dataUrl}" download="Protecta-Bode-Policy-${safePolicyNo}.pdf" style="display:inline-block;margin:12px 0;padding:13px 20px;border-radius:8px;background:#0b1f3f;color:#fff;font-weight:700;text-decoration:none">Download full policy PDF</a>
<script>history.replaceState(null,'',${JSON.stringify(cleanUrl)});</script>`,
  });
};

/**
 * Policy links require the phone number on the policyholder's quote and then
 * offer one download for the full, filled-in policy PDF. Other generated
 * documents keep the staff-facing preview and Word/PDF actions below.
 */
export const handleDocumentView = async (
  event: RoutePayload,
): Promise<Response> => {
  const body = requestBody(event);
  const queryStringParameters = {
    ...event.queryStringParameters,
    ...(typeof body.ref === 'string' ? { ref: body.ref } : {}),
    ...(typeof body.policyNo === 'string' ? { policyNo: body.policyNo } : {}),
    ...(typeof body.asPdf === 'string' ? { asPdf: body.asPdf } : {}),
  };
  const requestEvent = { ...event, queryStringParameters } as RoutePayload;
  const db = new CoreDbClient();
  let document = await loadGeneratedDocument(db, requestEvent);
  const requestedPolicyNo = String(queryStringParameters.policyNo ?? '').trim();

  // A policy landing link can be opened before the created-event worker has
  // finished. Generate the full built-in policy template on demand rather
  // than falling back to the unrelated one-page certificate.
  if (!document && requestedPolicyNo && !requestEvent.queryStringParameters?.ref) {
    const policy = await db.findFirst(
      'insurancePolicies',
      { policyNo: { eq: requestedPolicyNo } },
      ['policyNo'],
    );

    if (policy) {
      document = await createGeneratedDocument(db, {
        policyNo: requestedPolicyNo,
      });
    }
  }

  // Regenerate the prior built-in plain-text rendition once so policyNo links
  // resolve to the new Word-exported HTML layout after an app upgrade.
  if (
    document &&
    requestedPolicyNo &&
    !requestEvent.queryStringParameters?.ref &&
    String(document.format ?? '').toUpperCase() !== 'HTML' &&
    String(document.content ?? '').trim().startsWith('# MOTOR PROTECTA BODE POLICY')
  ) {
    document = await createGeneratedDocument(db, {
      policyNo: requestedPolicyNo,
    });
  }

  const problem = requireContent(document);
  if (problem) return htmlResponse(problem, document ? 422 : 404);

  const reference = String(document!.reference);
  const content = String(document!.content);
  const policyNo = String(document!.policyNo ?? '').trim();
  const isHtml = String(document!.format ?? 'TEXT').toUpperCase() === 'HTML';
  const wantsPdf = String(
    body.asPdf ?? queryStringParameters.asPdf ?? '',
  ) === '1';
  const phone = String(
    body.phone ?? event.queryStringParameters?.phone ?? '',
  ).trim();
  const docxHref = `/s/docgen/documents/docx?ref=${encodeURIComponent(reference)}`;
  const pdfHref = `/s/docgen/documents/view?ref=${encodeURIComponent(reference)}&asPdf=1`;
  const footer = `Policy ${policyNo} · Document ${reference}`;

  if (policyNo) {
    const expectedPhone = await getPolicyholderPhone(db, policyNo);

    if (!expectedPhone) {
      return htmlResponse(
        renderDocPage({
          title: 'Policy phone unavailable',
          heading: 'Contact Protecta Bode',
          bodyHtml:
            '<p class="note">We could not verify a phone number for this policy. Please contact Protecta Bode support to receive your policy document.</p>',
        }),
        422,
      );
    }

    if (!phone) {
      return htmlResponse(phoneEntryPage(reference));
    }

    const expectedDigits = lastNineDigits(expectedPhone);
    const providedDigits = lastNineDigits(phone);

    if (
      expectedDigits.length !== 9 ||
      providedDigits.length !== 9 ||
      expectedDigits !== providedDigits
    ) {
      return htmlResponse(
        phoneEntryPage(
          reference,
          'That phone number did not match the number used at purchase. Please try again.',
        ),
        403,
      );
    }

    try {
      const policyHtml = isHtml
        ? content
        : structuredTextToHtml(parseStructuredText(content));
      const pdf = await renderHtmlToPdf(policyHtml, phone);

      return htmlResponse(policyPdfDownloadPage(policyNo, reference, pdf));
    } catch (error) {
      console.error('policy HTML-to-PDF rendering failed', error);
      return htmlResponse(
        renderDocPage({
          title: 'Policy PDF unavailable',
          heading: 'The policy PDF is temporarily unavailable',
          bodyHtml:
            '<p class="note">Please try again shortly. If the problem continues, contact Protecta Bode support.</p>',
        }),
        503,
      );
    }
  }

  if (isHtml && !wantsPdf) {
    return htmlResponse(
      renderDocPage({
        title: `Document ${reference}`,
        heading: `Document ${reference}`,
        bodyHtml: `
<p class="note">Document ${reference} ·
<a href="${pdfHref}">Download PDF (plain layout)</a> ·
<a href="${docxHref}">Download Word copy</a> ·
<a href="javascript:window.print()">Print / Save as PDF</a></p>
${DOCUMENT_STYLES}
<div class="doc">${content}</div>`,
      }),
    );
  }

  if (!isHtml && !wantsPdf) {
    return htmlResponse(
      renderDocPage({
        title: `Document ${reference}`,
        heading: `Document ${reference}`,
        bodyHtml: `
<p class="note">Document ${reference} ·
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
      title: `Document ${reference}`,
      heading: `Document ${reference}`,
      bodyHtml: `
<p class="note">Document ${reference}</p>
<a href="${dataUrl}" download="document-${reference}.pdf">Download PDF</a>
<embed src="${dataUrl}" type="application/pdf" style="width:100%;height:80vh;border:0;border-radius:8px;background:#fff">`,
    }),
  );
};

export default defineLogicFunction({
  universalIdentifier: DOC_VIEW,
  name: 'document-view',
  description:
    'Renders generated documents. Protecta policy PDFs contain the complete policy wording and schedule, with phone verification before download.',
  timeoutSeconds: 60,
  handler: handleDocumentView,
  httpRouteTriggerSettings: {
    path: '/docgen/documents/view',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
