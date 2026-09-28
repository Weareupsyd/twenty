import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { REPORTS_INDEX } from 'src/constants/universal-identifiers';
import { escapeHtml, htmlResponse } from 'src/lib/http';
import { CoreDbClient } from 'src/lib/records';

type Kpi = { label: string; value: string; hint?: string };

const brand = { navy: '#0B1C48', gold: '#C1A24B', mint: '#0A7A3D' };

const shell = (title: string, body: string): string => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · Protecta Bode</title>
<style>
:root{--navy:${brand.navy};--gold:${brand.gold};--mint:${brand.mint};--line:#E6ECF2;--bg:#F4F6F8}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;background:var(--bg);color:#1A2B3C}
.wrap{max-width:1200px;margin:0 auto;padding:24px 16px}
.top{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px 20px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between}
.top h1{margin:0;font-size:22px;color:var(--navy)} .muted{color:#5B6B7C;font-size:13px;line-height:1.5}
.btn{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--navy);font-weight:700;text-decoration:none;font-size:13px}
.btn.primary{background:var(--navy);color:#fff;border-color:var(--navy)} .btn.gold{background:var(--gold);color:#1A1A1A;border-color:var(--gold)}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px;margin-top:16px}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px}
.kpi{grid-column:span 3} @media(max-width:900px){.kpi{grid-column:span 6}} @media(max-width:600px){.kpi,.col6,.col4,.col12{grid-column:span 12!important}}
.col6{grid-column:span 6} .col4{grid-column:span 4} .col12{grid-column:span 12}
.kpi .label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7D90;font-weight:700}
.kpi .value{font-size:22px;font-weight:800;color:var(--navy);margin:6px 0 4px}
.table{width:100%;border-collapse:collapse;font-size:13px} .table th{ text-align:left; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:#6B7D90; padding:8px 10px; border-bottom:1px solid var(--line)} .table td{ padding:8px 10px; border-bottom:1px solid #EEF2F6}
.badge{display:inline-block;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid var(--line);background:#F0F6FF}
.badge.green{background:#E6F6EC;color:#0A5C2E;border-color:#C6EAD5} .badge.yellow{background:#FFF8E1;color:#7A5A00;border-color:#FFE9A8} .badge.red{background:#FDECEB;color:#8A1C17;border-color:#F5C2C0} .badge.gray{background:#F0F2F5;color:#4A5A6A}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:end} .filters label{font-size:12px;color:#4A5A6A;font-weight:600} .filters input,.filters select{padding:8px 10px;border:1px solid #D4DDE6;border-radius:8px;font-size:13px}
</style></head><body><div class="wrap">${body}</div></body></html>`;

const fmtUgx = (n: unknown): string => {
  const num = typeof n === 'string' ? Number(n) : (n as number);
  return Number.isFinite(num) ? num.toLocaleString('en-UG') : '—';
};

const fmtDate = (v: unknown): string => {
  if (!v) return '—';
  return String(v).slice(0, 10);
};

const buildFilter = (q: Record<string, string | undefined>, keys: string[]) => {
  // naive filter builder for preview — actual export filters by JS post-fetch
  return q;
};

const handler = async (event: RoutePayload): Promise<Response> => {
  const qs = (event.queryStringParameters ?? {}) as Record<string, string | undefined>;
  const from = (qs.from ?? '').slice(0, 10);
  const to = (qs.to ?? '').slice(0, 10);
  const db = new CoreDbClient();
  // Fetch lightweight samples
  const [quotes, policies, payments, claims, commissions] = await Promise.all([
    db.findMany('insuranceQuotes', { first: 200 }, ['reference', 'status', 'channel', 'premium', 'plate', 'validUntil']).catch(() => []),
    db.findMany('insurancePolicies', { first: 200 }, ['policyNo', 'status', 'premiumUgx', 'totalPremiumUgx', 'periodStart', 'periodEnd']).catch(() => []),
    db.findMany('insurancePayments', { first: 200 }, ['paymentRef', 'provider', 'status', 'amountUgx']).catch(() => []),
    db.findMany('insuranceClaims', { first: 200 }, ['claimRef', 'status', 'reserveUgx']).catch(() => []),
    db.findMany('commissions', { first: 200 }, ['amountUgx', 'status', 'statementMonth']).catch(() => []),
  ]);

  const sum = (rows: Record<string, unknown>[], field: string) =>
    rows.reduce((a, r) => a + (Number(r[field]) || 0), 0);

  const kpis: Kpi[] = [
    { label: 'Quotes', value: String(quotes.length), hint: `${quotes.filter((q) => q.status === 'QUOTED').length} quoted` },
    { label: 'Active policies', value: String(policies.filter((p) => p.status === 'ACTIVE').length), hint: `${policies.length} total` },
    { label: 'Premium (UGX)', value: fmtUgx(sum(policies, 'premiumUgx')), hint: 'sum active+others' },
    { label: 'Confirmed payments (UGX)', value: fmtUgx(sum(payments.filter((p) => p.status === 'CONFIRMED'), 'amountUgx')), hint: `${payments.filter((p) => p.status === 'PENDING').length} pending` },
    { label: 'Open claims', value: String(claims.filter((c) => ['REPORTED','ASSIGNED','ASSESSED'].includes(String(c.status))).length), hint: `${claims.length} total` },
    { label: 'Claims reserve (UGX)', value: fmtUgx(sum(claims, 'reserveUgx')) },
    { label: 'Commissions (UGX)', value: fmtUgx(sum(commissions, 'amountUgx')), hint: `${commissions.filter((c) => c.status === 'PAYABLE').length} payable` },
    { label: 'Pending payments', value: String(payments.filter((p) => p.status === 'PENDING').length) },
  ];

  const kpiCards = kpis.map((k) => `<div class="card kpi"><div class="label">${escapeHtml(k.label)}</div><div class="value">${escapeHtml(k.value)}</div>${k.hint ? `<div class="muted">${escapeHtml(k.hint)}</div>` : ''}</div>`).join('');

  const filterBar = `<form class="filters" method="get" action="/s/protecta/reports">
    <div><label>From<br><input type="date" name="from" value="${escapeHtml(from)}"></label></div>
    <div><label>To<br><input type="date" name="to" value="${escapeHtml(to)}"></label></div>
    <div><label>Status / provider hints ignored in preview — applied on Export<br><button class="btn" type="submit">Apply</button></label></div>
    <div class="muted" style="margin-left:auto">Dashboard: <a href="/s/protecta/reports">Reports</a> · <a href="/s/protecta/">Protecta app</a> · <a href="/">Twenty</a></div>
  </form>`;

  const reportCard = (title: string, desc: string, type: string, extra?: string): string => {
    const qsExp = new URLSearchParams({ type, format: 'xlsx', ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
    const qsCsv = new URLSearchParams({ type, format: 'csv', ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
    const qsHtml = new URLSearchParams({ type, format: 'html', ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
    return `<div class="card col4"><h3 style="margin:0 0 6px;color:${brand.navy}">${escapeHtml(title)}</h3><p class="muted" style="margin:0 0 12px">${escapeHtml(desc)}</p>${extra ?? ''}<div style="display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn primary" href="/s/protecta/reports/export?${qsExp}">⬇ Excel (.xlsx)</a>
      <a class="btn" href="/s/protecta/reports/export?${qsCsv}">CSV</a>
      <a class="btn" href="/s/protecta/reports/export?${qsHtml}">Preview</a>
    </div></div>`;
  };

  const reportsGrid = `<div class="grid">
    ${reportCard('Quotes', 'All quotes with channel, status, premium, plate, phone, valid-until. Finance + ops reconciliation.', 'quotes')}
    ${reportCard('Policies', 'Issued policies, premium, total premium, levies, period, plate. Expiring next 30/60 days.', 'policies')}
    ${reportCard('Payments', 'MoMo / Airtel / bank payments, provider refs, reconciliation status.', 'payments')}
    ${reportCard('Claims', 'Claims from REPORTED → SETTLED with reserve. Loss overview for compliance.', 'claims')}
    ${reportCard('Commissions', 'Agent/broker commissions by statement month, status PAYABLE/ACCRUED/PAID.', 'commissions')}
    ${reportCard('Premium reconciliation', 'Policy premium vs confirmed payments — underpaid, overpaid, pending.', 'reconciliation', '<div class="muted" style="margin-bottom:10px">Joins closest payment by quoteRef; flags gaps.</div>')}
    ${reportCard('Expiring & renewals', 'Policies ending within window (default 30 days). Renewal call list.', 'expiring')}
    ${reportCard('Overdue & KYC', 'Support tickets overdue + KYC pending by risk tier. Ops follow-up.', 'kyc')}
    ${reportCard('Finance — commissions + reserve', 'Combined finance extract for accounting: commissions + claim reserves by month.', 'finance')}
  </div>`;

  const preview = `<div class="grid">
    <div class="card col6"><h3 style="margin:0 0 10px">Recent quotes</h3><table class="table"><thead><tr><th>Ref</th><th>Status</th><th>Channel</th><th class="muted">Premium</th></tr></thead><tbody>
      ${quotes.slice(0, 8).map((q) => `<tr><td>${escapeHtml(String(q.reference ?? ''))}</td><td><span class="badge">${escapeHtml(String(q.status ?? ''))}</span></td><td>${escapeHtml(String(q.channel ?? ''))}</td><td>${fmtUgx(q.premium)}</td></tr>`).join('') || `<tr><td colspan="4" class="muted">No data</td></tr>`}
    </tbody></table></div>
    <div class="card col6"><h3 style="margin:0 0 10px">Recent policies</h3><table class="table"><thead><tr><th>Policy</th><th>Status</th><th>Premium</th><th>Period</th></tr></thead><tbody>
      ${policies.slice(0, 8).map((p) => `<tr><td>${escapeHtml(String(p.policyNo ?? ''))}</td><td><span class="badge green">${escapeHtml(String(p.status ?? ''))}</span></td><td>${fmtUgx(p.premiumUgx)}</td><td class="muted">${fmtDate(p.periodStart)} → ${fmtDate(p.periodEnd)}</td></tr>`).join('') || `<tr><td colspan="4" class="muted">No data</td></tr>`}
    </tbody></table></div>
    <div class="card col6"><h3 style="margin:0 0 10px">Recent payments</h3><table class="table"><thead><tr><th>Payment</th><th>Provider</th><th>Status</th><th>Amount</th></tr></thead><tbody>
      ${payments.slice(0, 8).map((p) => `<tr><td>${escapeHtml(String(p.paymentRef ?? p.quoteRef ?? ''))}</td><td>${escapeHtml(String(p.provider ?? ''))}</td><td><span class="badge yellow">${escapeHtml(String(p.status ?? ''))}</span></td><td>${fmtUgx(p.amountUgx)}</td></tr>`).join('') || `<tr><td colspan="4" class="muted">No data</td></tr>`}
    </tbody></table></div>
    <div class="card col6"><h3 style="margin:0 0 10px">Recent claims</h3><table class="table"><thead><tr><th>Claim</th><th>Status</th><th>Reserve</th></tr></thead><tbody>
      ${claims.slice(0, 8).map((c) => `<tr><td>${escapeHtml(String(c.claimRef ?? ''))}</td><td><span class="badge red">${escapeHtml(String(c.status ?? ''))}</span></td><td>${fmtUgx(c.reserveUgx)}</td></tr>`).join('') || `<tr><td colspan="3" class="muted">No data</td></tr>`}
    </tbody></table></div>
  </div>`;

  const body = `
    <div class="top"><div><h1>Protecta Bode — Reports & Excel exports</h1><div class="muted">Dashboards speak to your Protecta Bode objects (quotes, policies, payments, claims, commissions). Every report has a one-click <b>Excel</b> download — warm for finance, ops, and partner reconciliation. Dates filter all exports.</div></div><div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn gold" href="/s/protecta/">Protecta home</a><a class="btn" href="/s/protecta/reports/export?type=policies&format=xlsx">Quick: policies.xlsx</a></div></div>
    <div class="card" style="margin-top:16px">${filterBar}</div>
    <div class="grid" style="margin-top:16px">${kpiCards}</div>
    ${reportsGrid}
    ${preview}
    <div class="card col12" style="margin-top:16px"><h3 style="margin:0 0 8px">How dashboards + reports connect</h3><p class="muted">The <b>Protecta Bode Ops</b> dashboard (Twenty → left nav) renders the same objects: KPIs and PIE/BAR charts by <em>status / channel / provider</em> and trends by month. Reports reuse that data — add a date window above and hit <b>Excel</b>; files are generated server-side from live Twenty records as <code>.xlsx</code> (HTML-table Excel) and <code>.csv</code>. No desktop Excel required; files open in Excel, Sheets, and Numbers. For embedded viewing, add a <code>format=html</code> preview first.</p><p class="muted">Programmatic: <code>GET /s/protecta/reports/export?type=quotes|policies|payments|claims|commissions|reconciliation|expiring|finance&amp;format=xlsx|csv&amp;from=YYYY-MM-DD&amp;to=YYYY-MM-DD</code>. Returns <code>Content-Disposition: attachment</code>.</p></div>
  `;

  return htmlResponse(shell('Reports', body));
};

export default defineLogicFunction({
  universalIdentifier: REPORTS_INDEX,
  name: 'reports-index',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/reports',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
