import { escapeHtml } from 'src/lib/http';
import { formatUgx } from 'src/lib/money';
import { type RecordData } from 'src/lib/records';

const STYLE = `
  :root { color-scheme: light; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; margin: 0; background: #f4f6f8; color: #1c2b3a; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 24px 16px 64px; }
  .card { background: #fff; border-radius: 16px; padding: 28px; box-shadow: 0 8px 30px rgba(20,40,70,.08); }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
  .brand-mark { width: 44px; height: 44px; border-radius: 12px; background: #0a7a3d; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 800; }
  .brand h1 { font-size: 20px; margin: 0; }
  .brand p { margin: 2px 0 0; color: #5b6b7c; font-size: 13px; }
  h2 { font-size: 16px; margin: 22px 0 10px; }
  .rows { border-top: 1px solid #e6ecf2; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid #eef2f6; font-size: 14px; }
  .row span:first-child { color: #5b6b7c; }
  .row span:last-child { font-weight: 600; text-align: right; }
  .pill { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; background: #e8f5ec; color: #0a7a3d; }
  .pill.warn { background: #fff4dd; color: #9a6200; }
  .pill.bad { background: #fdeceb; color: #b3261e; }
  .total { font-size: 22px; font-weight: 800; color: #0a7a3d; }
  .cta { display: block; margin-top: 22px; background: #0a7a3d; color: #fff !important; text-align: center; padding: 14px; border-radius: 12px; font-weight: 700; text-decoration: none; }
  .muted { color: #5b6b7c; font-size: 13px; margin-top: 14px; line-height: 1.5; }
  .field { margin: 12px 0; }
  .field label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  .field input, .field select, .field textarea { width: 100%; padding: 12px; border: 1px solid #d4dde6; border-radius: 10px; font-size: 15px; box-sizing: border-box; }
  .btn { width: 100%; margin-top: 8px; background: #0a7a3d; color: #fff; border: 0; padding: 14px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; }
  .note { background: #f0f6ff; border: 1px solid #d6e6ff; border-radius: 10px; padding: 12px; font-size: 13px; margin-top: 16px; }
  @media print { .cta, .btn, form { display: none; } body { background: #fff; } .card { box-shadow: none; } }
`;

const shell = (title: string, body: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Protecta Bode</title><style>${STYLE}</style></head>
<body><div class="wrap"><div class="card">
<div class="brand"><div class="brand-mark">P</div><div><h1>Protecta Bode</h1><p>Motor cover in minutes · 1.5% of value</p></div></div>
${body}</div></div></body></html>`;

const statusPill = (status: string): string => {
  const cls = ['ACTIVE', 'QUOTED', 'CONFIRMED', 'APPROVED', 'SETTLED', 'DELIVERED'].includes(status)
    ? ''
    : ['EXPIRED', 'REJECTED', 'FAILED', 'CANCELLED'].includes(status)
      ? 'bad'
      : 'warn';
  return `<span class="pill ${cls}">${escapeHtml(status)}</span>`;
};

export const renderQuotePage = (quote: RecordData, payUrl: string): string =>
  shell(
    `Quote ${quote.reference}`,
    `
<h2>Motor quote ${statusPill(String(quote.status))}</h2>
<div class="rows">
  <div class="row"><span>Quote ref</span><span>${escapeHtml(String(quote.reference))}</span></div>
  <div class="row"><span>Plate</span><span>${escapeHtml(String(quote.plate ?? ''))}</span></div>
  <div class="row"><span>Vehicle</span><span>${escapeHtml(`${quote.vehicleMake ?? ''} ${quote.vehicleModel ?? ''}`.trim() || '—')}</span></div>
  <div class="row"><span>Vehicle value</span><span>${escapeHtml(formatUgx(Number(quote.vehicleValue ?? 0)))}</span></div>
  <div class="row"><span>Valid until</span><span>${escapeHtml(String(quote.validUntil ?? ''))}</span></div>
</div>
<h2>Premium due</h2>
<div class="total">${escapeHtml(formatUgx(Number(quote.premium ?? 0)))}</div>
<p class="muted">1.5% of vehicle value · 12 months comprehensive-equivalent motor cover.</p>
${quote.status === 'QUOTED' ? `<a class="cta" href="${escapeHtml(payUrl)}">Pay with mobile money</a>` : ''}
<p class="muted">Questions? WhatsApp ${escapeHtml(process.env.SUPPORT_PHONE ?? '')}.</p>`,
  );

export const renderPolicyPage = (policy: RecordData): string =>
  shell(
    `Policy ${policy.policyNo}`,
    `
<h2>Motor policy certificate ${statusPill(String(policy.status))}</h2>
<div class="rows">
  <div class="row"><span>Policy no</span><span>${escapeHtml(String(policy.policyNo))}</span></div>
  <div class="row"><span>Plate</span><span>${escapeHtml(String(policy.plate ?? ''))}</span></div>
  <div class="row"><span>Vehicle</span><span>${escapeHtml(`${policy.vehicleMake ?? ''} ${policy.vehicleModel ?? ''}`.trim() || '—')}</span></div>
  <div class="row"><span>Premium paid</span><span>${escapeHtml(formatUgx(Number(policy.premiumUgx ?? 0)))}</span></div>
  <div class="row"><span>Cover from</span><span>${escapeHtml(String(policy.periodStart ?? ''))}</span></div>
  <div class="row"><span>Cover until</span><span>${escapeHtml(String(policy.periodEnd ?? ''))}</span></div>
</div>
<div class="note">Keep this page as proof of cover. For claims, WhatsApp ${escapeHtml(process.env.SUPPORT_PHONE ?? '')} or reply <b>4</b> to the Protecta bot.</div>`,
  );

export const renderClaimPage = (claim: RecordData): string =>
  shell(
    `Claim ${claim.claimRef}`,
    `
<h2>Claim ${statusPill(String(claim.status))}</h2>
<div class="rows">
  <div class="row"><span>Claim ref</span><span>${escapeHtml(String(claim.claimRef))}</span></div>
  <div class="row"><span>Policy</span><span>${escapeHtml(String(claim.policyNo ?? ''))}</span></div>
  <div class="row"><span>Location</span><span>${escapeHtml(String(claim.location ?? '—'))}</span></div>
  <div class="row"><span>Incident date</span><span>${escapeHtml(String(claim.incidentDate ?? '—'))}</span></div>
  <div class="row"><span>Description</span><span>${escapeHtml(String(claim.description ?? ''))}</span></div>
</div>
<p class="muted">Our assessors will call ${escapeHtml(String(claim.reporterPhone ?? ''))} with next steps.</p>`,
  );

export const renderKycPage = (submitPath: string, phone: string): string =>
  shell(
    'Identity check',
    `
<h2>Identity check</h2>
<p class="muted">Enter the ID details for <b>${escapeHtml(phone)}</b>. Our team reviews every submission, usually within one business day.</p>
<form method="post" action="${escapeHtml(submitPath)}">
  <input type="hidden" name="phone" value="${escapeHtml(phone)}">
  <div class="field"><label>ID type</label><select name="idType"><option value="NIN">National ID (NIN)</option><option value="PASSPORT">Passport</option><option value="DRIVING_LICENCE">Driving licence</option></select></div>
  <div class="field"><label>ID number</label><input name="idNumber" required minlength="4" placeholder="e.g. CM12345678ABCDE"></div>
  <div class="field"><label>Full name (as on ID)</label><input name="name" placeholder="Optional"></div>
  <button class="btn" type="submit">Submit for review</button>
</form>`,
  );

export const renderErrorPage = (title: string, detail: string): string =>
  shell(title, `<h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(detail)}</p>`);

export const renderPaymentPage = (payment: RecordData, instructions: string): string =>
  shell(
    `Payment ${payment.paymentRef}`,
    `
<h2>Payment ${statusPill(String(payment.status))}</h2>
<div class="rows">
  <div class="row"><span>Payment ref</span><span>${escapeHtml(String(payment.paymentRef))}</span></div>
  <div class="row"><span>Quote</span><span>${escapeHtml(String(payment.quoteRef ?? ''))}</span></div>
  <div class="row"><span>Provider</span><span>${escapeHtml(String(payment.provider ?? ''))}</span></div>
  <div class="row"><span>Amount</span><span>${escapeHtml(formatUgx(Number(payment.amountUgx ?? 0)))}</span></div>
</div>
<div class="note">${instructions}</div>`,
  );
