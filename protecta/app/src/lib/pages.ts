import { getPublicAssetUrl } from 'twenty-sdk/utils';
import { browserAssetUrl } from 'src/lib/browser-asset-url';
import { escapeHtml } from 'src/lib/http';
import { formatUgx } from 'src/lib/money';
import { type RecordData } from 'src/lib/records';

const STYLE = `
  :root { color-scheme: light; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; margin: 0; background: #EEF8FB; color: #162044; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 24px 16px 64px; }
  .card { background: #fff; border-radius: 16px; padding: 28px; box-shadow: 0 8px 30px rgba(20,40,70,.08); }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
  .brand-mark { width: 44px; height: 44px; border-radius: 12px; background: #0B1C48; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 800; }
  .brand h1 { font-size: 20px; margin: 0; }
  .brand p { margin: 2px 0 0; color: #56607F; font-size: 13px; }
  h2 { font-size: 16px; margin: 22px 0 10px; }
  .rows { border-top: 1px solid #BCDCE7; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid #DDF1F6; font-size: 14px; }
  .row span:first-child { color: #56607F; }
  .row span:last-child { font-weight: 600; text-align: right; }
  .pill { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; background: #DDF1F6; color: #0B1C48; }
  .pill.warn { background: #fff4dd; color: #9a6200; }
  .pill.bad { background: #fdeceb; color: #b3261e; }
  .total { font-size: 22px; font-weight: 800; color: #CA6E2B; }
  .cta:hover { background: #B25E20; }
  .brand-logo { height: 56px; width: auto; display: block; }
  .cta { display: block; margin-top: 22px; background: #CA6E2B; color: #fff !important; text-align: center; padding: 14px; border-radius: 12px; font-weight: 700; text-decoration: none; }
  .muted { color: #56607F; font-size: 13px; margin-top: 14px; line-height: 1.5; }
  .field { margin: 12px 0; }
  .field label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  .field input, .field select, .field textarea { width: 100%; padding: 12px; border: 1px solid #d4dde6; border-radius: 10px; font-size: 15px; box-sizing: border-box; }
  .btn { width: 100%; margin-top: 8px; background: #0B1C48; color: #fff; border: 0; padding: 14px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; }
  .btn-outline { background: #fff; color: #0B1C48; border: 1px solid #0B1C48; }
  .btn-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 12px; }
  .btn-row .btn { margin-top: 0; }
  @media (max-width: 420px) { .btn-row { grid-template-columns: 1fr; } }
  .note { background: #EEF8FB; border: 1px solid #BCDCE7; border-radius: 10px; padding: 12px; font-size: 13px; margin-top: 16px; }
  .alert { background: #fff4dd; border: 1px solid #f0d48a; color: #7a4a00; border-radius: 10px; padding: 10px 12px; font-size: 13px; margin-top: 12px; display: none; }
  .alert.show { display: block; }
  @media print { .no-print { display: none !important; } body { background: #fff; } .card { box-shadow: none; } }
`;

const brandLogo = (): string => {
  try {
    const url = browserAssetUrl(getPublicAssetUrl('brand/assets/protecta-bode-logo.png'));
    return `<img class="brand-logo" src="${escapeHtml(url)}" alt="Protecta Bode">`;
  } catch {
    return '<h1>Protecta Bode</h1>';
  }
};

const shell = (title: string, body: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Protecta Bode</title><style>${STYLE}</style></head>
<body><div class="wrap"><div class="card">
<div class="brand">${brandLogo()}<div><p>Motor cover in minutes · 1.5% of value</p></div></div>
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
${quote.status === 'QUOTED' ? `<a class="cta" href="/s/protecta/?ref=${encodeURIComponent(String(quote.reference))}">Pay with mobile money — resume & complete</a><p class="muted" style="margin-top:10px">Your quote is saved. If you abandon payment you can return via <a href="/s/protecta/quotes/resume?ref=${encodeURIComponent(String(quote.reference))}">this link</a> or <a href="/s/protecta/quotes/resume">Find my quotes</a> with phone ${escapeHtml(String(quote.policyholderPhone ?? ''))} to complete payment and your policy will be created.</p>` : (quote.status === 'ACCEPTED' ? `<div class="note">This quote is already paid. <a class="btn" href="/s/protecta/policies/doc?ref=${encodeURIComponent(String(quote.reference))}">Download full policy PDF</a></div>` : '')}
${quote.status === 'QUOTED' ? `<div class="no-print" style="margin-top:10px"><button class="btn" id="convertBtn" onclick="convertQuote('${escapeHtml(String(quote.reference))}')">✓ Convert to policy</button><div id="convertAlert" class="alert"></div></div>` : ''}
<p class="muted">Questions? WhatsApp ${escapeHtml(process.env.SUPPORT_PHONE ?? '')}.</p>
<script>
function convertQuote(ref){
  var btn=document.getElementById('convertBtn'); var alert=document.getElementById('convertAlert');
  if(!btn) return;
  btn.disabled=true; btn.textContent='Converting…'; alert.classList.remove('show');
  fetch('/s/protecta/quotes/convert', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({quoteRef: ref})})
    .then(function(r){
      if(r.status===401 || r.status===403) throw new Error('Please sign in as staff in Twenty, then use the quote record → “Convert to policy” (pinned command). This button requires staff auth.');
      return r.json().then(function(j){ return {ok:r.ok, body:j}; });
    })
    .then(function(res){
      if(!res.ok || res.body.ok===false) throw new Error(res.body.error||'Conversion failed');
      var policyNo = res.body.policy ? res.body.policy.policyNo : (res.body.policyNo||'');
      if(!policyNo) throw new Error('Policy created but number missing. Check Policies → search by quote ref '+ref);
      alert.textContent='Policy '+policyNo+' created. Redirecting…'; alert.classList.add('show');
      setTimeout(function(){ window.location.href='/s/protecta/policies/doc?ref='+encodeURIComponent(policyNo); }, 900);
    })
    .catch(function(e){ alert.textContent=e.message||'Could not convert quote.'; alert.classList.add('show'); btn.disabled=false; btn.textContent='✓ Convert to policy'; });
}
</script>`,
  );

export const renderPolicyPage = (policy: RecordData): string =>
  shell(
    `Policy ${policy.policyNo}`,
    `
<h2>Motor policy ${statusPill(String(policy.status))}</h2>
<div class="rows">
  <div class="row"><span>Policy no</span><span>${escapeHtml(String(policy.policyNo))}</span></div>
  <div class="row"><span>Plate</span><span>${escapeHtml(String(policy.plate ?? ''))}</span></div>
  <div class="row"><span>Vehicle</span><span>${escapeHtml(`${policy.vehicleMake ?? ''} ${policy.vehicleModel ?? ''}`.trim() || '—')}</span></div>
  <div class="row"><span>Premium paid</span><span>${escapeHtml(formatUgx(Number(policy.premiumUgx ?? 0)))}</span></div>
  <div class="row"><span>Cover from</span><span>${escapeHtml(String(policy.periodStart ?? ''))}</span></div>
  <div class="row"><span>Cover until</span><span>${escapeHtml(String(policy.periodEnd ?? ''))}</span></div>
</div>
<div class="no-print" style="margin-top:16px">
  <button class="btn" id="downloadPdfBtn" onclick="downloadPolicyPdf('${escapeHtml(String(policy.policyNo))}')">⬇ Download full policy PDF</button>
</div>
<p class="muted no-print" style="font-size:12.5px">The PDF contains the full Liberty Motor Protecta Bode policy and your completed schedule. Enter the phone number used at purchase on the next screen to download it.</p>
<div class="note">For claims, WhatsApp ${escapeHtml(process.env.SUPPORT_PHONE ?? '')} or reply <b>4</b> to the Protecta bot.</div>
<script>
function downloadPolicyPdf(policyNo){
  var btn=document.getElementById('downloadPdfBtn');
  if(btn){ btn.disabled=true; btn.textContent='Opening secure download…'; }
  window.location.href='/s/docgen/documents/view?policyNo='+encodeURIComponent(policyNo)+'&asPdf=1';
}
</script>`,
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

export const renderResumePage = (params: { quotes: RecordData[]; phone: string; ref: string; policyMap: Record<string, RecordData | null>; paymentsMap?: Record<string, RecordData[]>; notice?: string }): string => {
  const q = params.quotes;
  const has = q.length > 0;
  const form = `
    <form method="get" action="/s/protecta/quotes/resume" class="no-print">
      <div class="field"><label>Phone number</label><input name="phone" type="tel" inputmode="tel" autofocus value="${escapeHtml(params.phone)}" placeholder="0701 440 613" /></div>
      <div class="field"><label>Or quote reference (optional)</label><input name="ref" value="${escapeHtml(params.ref)}" placeholder="PB-...." /></div>
      <button class="btn" type="submit">Search</button>
    </form>
    `;
  if (!has) {
    const searched = Boolean(params.phone || params.ref);
    const message = params.notice
      ? escapeHtml(params.notice)
      : searched
        ? `No quotes found for <b>${escapeHtml(params.phone || params.ref)}</b>. Check the number or reference and try again, or <a href="/s/protecta/">start a new quote</a>.`
        : '';
    return shell('Find my quotes', `<h2>Find my quotes</h2><p class="muted">Enter the phone number you used to get your quote. We will list all your quotes so you can finish payment.</p>${form}${message ? `<div class="note">${message}</div>` : ''}`);
  }
  const rows = q.map((quote) => {
    const ref = String((quote as any).reference);
    const status = String((quote as any).status ?? '');
    const policy = params.policyMap[ref];
    const premium = formatUgx(Number((quote as any).premium ?? 0));
    const policyNo = policy ? String((policy as any).policyNo ?? '') : '';
    const pays: RecordData[] = (params.paymentsMap && params.paymentsMap[ref]) ? params.paymentsMap[ref] as RecordData[] : [];
    const pending = pays.find((x: any) => String(x.status) === 'PENDING');
    const action = status === 'ACCEPTED' && policyNo
      ? `<a class="btn" href="/s/protecta/policies/doc?ref=${encodeURIComponent(policyNo)}">Download full policy PDF</a>`
      : status === 'QUOTED'
        ? (pending ? `<div class="note" style="margin-bottom:10px">Pending payment <b>${escapeHtml(String((pending as any).paymentRef ?? ''))}</b> — check your phone for the prompt, or retry.</div><a class="cta" href="/s/protecta/?ref=${encodeURIComponent(ref)}" style="margin-top:0">Resume & pay ${escapeHtml(premium)}</a> <a class="btn btn-outline" href="#" onclick="event.preventDefault(); fetch('/s/protecta/api/payments/get?ref='+encodeURIComponent('${escapeHtml(String((pending as any).paymentRef ?? ''))}')).then(r=>r.json()).then(d=>{ if(d.policy && d.policy.policyNo){ alert('Payment confirmed! Policy '+d.policy.policyNo); location.href='/s/protecta/policies/doc?ref='+encodeURIComponent(d.policy.policyNo);} else alert('Still '+d.payment.status+'. Approve on phone or try again.');}); return false;" style="margin-top:8px;display:block;text-align:center">Check status</a>` : `<a class="cta" href="/s/protecta/?ref=${encodeURIComponent(ref)}" style="margin-top:0">Resume & pay ${escapeHtml(premium)}</a>`)
        : `<span class="pill ${status === 'EXPIRED' ? 'bad' : 'warn'}">${escapeHtml(status)}</span>`;
    return `<div class="rows" style="margin-top:16px;padding:16px;border:1px solid #BCDCE7;border-radius:12px;"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><strong>${escapeHtml(ref)}</strong> ${statusPill(status)}</div><div class="row"><span>Plate</span><span>${escapeHtml(String((quote as any).plate ?? ''))}</span></div><div class="row"><span>Vehicle</span><span>${escapeHtml(`${(quote as any).vehicleMake ?? ''} ${(quote as any).vehicleModel ?? ''}`.trim() || '—')}</span></div><div class="row"><span>Premium</span><span>${escapeHtml(premium)}</span></div>${policyNo ? `<div class="row"><span>Policy</span><span>${escapeHtml(policyNo)}</span></div>` : ''}<div style="margin-top:12px">${action}</div></div>`;
  }).join('');
  return shell('Resume payment', `<h2>Resume & complete payment</h2><p class="muted">Found ${q.length} quote(s). Complete payment to create your policy. Before downloading the full PDF, you will verify the phone number used at purchase.</p>${form}<div style="margin-top:18px">${rows}</div><p class="muted" style="margin-top:18px"><a href="/s/protecta/">Start a new quote</a></p>`);
};

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
