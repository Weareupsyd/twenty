import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { POLICY_PDF } from 'src/constants/universal-identifiers';
import { escapeHtml, htmlResponse } from 'src/lib/http';
import { renderErrorPage } from 'src/lib/pages';
import { normalizeUgPhone } from 'src/lib/phones';
import { generatePolicyPdf } from 'src/lib/policy-pdf';
import { CoreDbClient } from 'src/lib/records';
import { findQuoteByRef } from 'src/lib/service-quotes';
import { findPolicyByNo } from 'src/lib/service-policies';

const renderPasswordPage = (ref: string, phoneHint: string, error?: string): string => {
  const esc = escapeHtml;
  const err = error ? `<div class="note" style="background:#fdeceb;border-color:#f5c2c0;color:#8a1c17;margin-bottom:16px">${esc(error)}</div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Password required · Protecta Bode</title><style>body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;margin:0;background:#f4f6f8;color:#1c2b3a} .wrap{max-width:640px;margin:0 auto;padding:24px 16px} .card{background:#fff;border-radius:16px;padding:28px;box-shadow:0 8px 30px rgba(20,40,70,.08)} h2{margin:0 0 8px} .field{margin:12px 0} .field label{display:block;font-size:13px;font-weight:600;margin-bottom:6px} .field input{width:100%;padding:12px;border:1px solid #d4dde6;border-radius:10px;font-size:15px;box-sizing:border-box} .btn{width:100%;margin-top:8px;background:#0a7a3d;color:#fff;border:0;padding:14px;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer} .muted{color:#5b6b7c;font-size:13px;margin-top:12px;line-height:1.5} .note{background:#f0f6ff;border:1px solid #d6e6ff;border-radius:10px;padding:12px;font-size:13px;margin-top:12px}</style></head><body><div class="wrap"><div class="card"><h2>🔒 Password-protected PDF</h2><p class="muted">Your Protecta Bode policy <b>${esc(ref)}</b> is protected. Enter the <b>phone number you used at purchase</b> to open it. This is the password for the PDF (also required inside the file when opened in a PDF reader).</p>${err}<form method="get" action="/s/protecta/policies/pdf"><input type="hidden" name="ref" value="${esc(ref)}"><div class="field"><label>Phone number (password)</label><input name="phone" type="tel" placeholder="${esc(phoneHint || '0701 440 613')}" required /></div><button class="btn" type="submit">Unlock &amp; download PDF</button></form><p class="muted">Example: if you bought with <b>${esc(phoneHint || '0701440613')}</b>, that is your password. The file will also prompt for this phone when opened.</p><p class="muted"><a href="/s/protecta/quotes/resume">Find my quotes</a> · <a href="/s/protecta/">New quote</a></p></div></div></body></html>`;
};

const handler = async (event: RoutePayload): Promise<Response> => {
  const ref = (event.queryStringParameters?.ref ?? '').trim().toUpperCase();
  const id = (event.queryStringParameters?.id ?? '').trim();
  const rawPhone = (event.queryStringParameters?.phone ?? event.queryStringParameters?.password ?? '').trim();
  const db = new CoreDbClient();
  let policy: any = null;
  if (id) {
    policy = await db.findFirst('insurancePolicies', { id: { eq: id } }, ['policyNo', 'quoteRef', 'status', 'plate', 'vehicleMake', 'vehicleModel', 'premiumUgx', 'sumInsuredUgx', 'periodStart', 'periodEnd', 'bodyType', 'engineCc', 'seatingCapacity']);
  } else if (ref) {
    policy = await findPolicyByNo(db, ref);
    // Allow downloading via quote ref as well (handy from quote page)
    if (!policy) {
      const quote = await findQuoteByRef(db, ref);
      if (quote) {
        policy = await db.findFirst('insurancePolicies', { quoteRef: { eq: String(quote.reference) } }, ['policyNo', 'quoteRef', 'status', 'plate', 'vehicleMake', 'vehicleModel', 'premiumUgx', 'sumInsuredUgx', 'periodStart', 'periodEnd', 'bodyType', 'engineCc', 'seatingCapacity']);
      }
    }
  }
  if (!ref && !id) {
    return htmlResponse(renderErrorPage('Missing reference', 'Provide ?ref=<policyNo> or ?id=<recordId>.'), 400);
  }
  if (!policy) {
    return htmlResponse(renderErrorPage('Policy not found', `No policy with number ${ref}. If you just converted a quote, try again in a moment.`), 404);
  }
  const quote = policy.quoteRef ? await findQuoteByRef(db, String(policy.quoteRef)) : null;
  const expectedRaw = String((quote as any)?.policyholderPhone ?? (policy as any)?.policyholderPhone ?? '');
  const expected = normalizeUgPhone(expectedRaw) || expectedRaw.replace(/[^0-9]/g, '').slice(-9);
  const providedNorm = rawPhone ? (normalizeUgPhone(rawPhone) || rawPhone.replace(/[^0-9]/g, '').slice(-9)) : '';
  const expectedNorm = expected ? (normalizeUgPhone(expected) || expected.replace(/[^0-9]/g, '').slice(-9)) : '';

  // If phone not provided, show password form (the PDF is password-protected)
  if (!rawPhone) {
    const hint = expectedRaw ? String(expectedRaw) : '0701 440 613';
    return htmlResponse(renderPasswordPage(policy.policyNo ? String(policy.policyNo) : ref, hint));
  }
  // If we know expected phone and it does not match, show error
  if (expectedNorm && providedNorm !== expectedNorm) {
    // Allow last-9 comparison for leniency
    const last9 = (s: string) => s.slice(-9);
    if (last9(providedNorm) !== last9(expectedNorm)) {
      const hint = expectedRaw ? String(expectedRaw) : '0701 440 613';
      return htmlResponse(renderPasswordPage(policy.policyNo ? String(policy.policyNo) : ref, hint, `Wrong phone number. Use the number you used at purchase (${hint}).`), 403);
    }
  }
  const pdfPassword = rawPhone || expectedRaw || undefined;
  const pdf = await generatePolicyPdf(policy, quote, pdfPassword);
  return new Response(pdf as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Protecta-${policy.policyNo}.pdf"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
};

export default defineLogicFunction({
  universalIdentifier: POLICY_PDF,
  name: 'policy-pdf',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/policies/pdf',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
