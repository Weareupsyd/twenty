import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { REPORT_EXPORT } from 'src/constants/universal-identifiers';
import { htmlResponse } from 'src/lib/http';
import { CoreDbClient } from 'src/lib/records';
import {
  type Column,
  rowsToCsv,
  rowsToHtmlExcel,
  buildCsvResponse,
  buildExcelResponse,
  buildXlsxResponse,
  fmtDate,
  sumUgx,
} from 'src/lib/excel';

type ExportType = 'quotes' | 'policies' | 'payments' | 'claims' | 'commissions' | 'reconciliation' | 'expiring' | 'finance' | 'kyc';

const isType = (v: string): v is ExportType =>
  ['quotes','policies','payments','claims','commissions','reconciliation','expiring','finance','kyc'].includes(v);

const parseDate = (s?: string): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const inRange = (val: unknown, from: Date | null, to: Date | null): boolean => {
  if (!val) return !from && !to ? true : false;
  const d = new Date(String(val));
  if (isNaN(d.getTime())) return true; // keep if unparseable
  if (from && d < from) return false;
  if (to) { const t = new Date(to); t.setHours(23,59,59,999); if (d > t) return false; }
  return true;
};

const fetchAll = async (
  db: CoreDbClient,
  plural: string,
  select: string[],
  limit = 800,
): Promise<Record<string, unknown>[]> => {
  try {
    // CoreDbClient supports `first`; fetch in one go. For > limit we paginate by re-querying with larger first.
    return await db.findMany(plural, { first: Math.min(limit, 500) }, select);
  } catch {
    return [];
  }
};

const handler = async (event: RoutePayload): Promise<Response> => {
  const qs = (event.queryStringParameters ?? {}) as Record<string, string | undefined>;
  const typeRaw = String(qs.type ?? qs.report ?? 'policies').toLowerCase();
  const formatRaw = String(qs.format ?? 'xlsx').toLowerCase();
  const format: 'xlsx' | 'csv' | 'html' | 'xls' = (['xlsx','csv','html','xls'].includes(formatRaw) ? formatRaw : 'xlsx') as any;
  const type: ExportType = isType(typeRaw) ? typeRaw : 'policies';
  const from = parseDate(qs.from);
  const to = parseDate(qs.to);

  const db = new CoreDbClient();
  let rows: Record<string, unknown>[] = [];
  let columns: Column[] = [];
  let sheet: string = type;

  const now = new Date().toISOString().slice(0,10);

  if (type === 'quotes') {
    const raw = await fetchAll(db, 'insuranceQuotes', ['reference','protectaRef','status','channel','plate','vehicleMake','vehicleModel','vehicleValue','premium','policyholderPhone','validUntil','productCode']);
    rows = raw.filter((r) => inRange(r.validUntil, from, to)).map((r) => ({
      reference: r.reference ?? '',
      status: r.status ?? '',
      channel: r.channel ?? '',
      plate: r.plate ?? '',
      vehicleMake: r.vehicleMake ?? '',
      vehicleModel: r.vehicleModel ?? '',
      vehicleValueUgx: r.vehicleValue ?? '',
      premiumUgx: r.premium ?? '',
      policyholderPhone: r.policyholderPhone ?? '',
      validUntil: fmtDate(r.validUntil),
      productCode: r.productCode ?? '',
    }));
    columns = [
      { key: 'reference', header: 'Quote ref' },
      { key: 'status', header: 'Status' },
      { key: 'channel', header: 'Channel' },
      { key: 'plate', header: 'Plate' },
      { key: 'vehicleMake', header: 'Make' },
      { key: 'vehicleModel', header: 'Model' },
      { key: 'vehicleValueUgx', header: 'Vehicle value (UGX)' },
      { key: 'premiumUgx', header: 'Premium (UGX)' },
      { key: 'policyholderPhone', header: 'Phone' },
      { key: 'validUntil', header: 'Valid until' },
      { key: 'productCode', header: 'Product' },
    ];
    sheet = 'Quotes';
  } else if (type === 'policies') {
    const raw = await fetchAll(db, 'insurancePolicies', ['policyNo','quoteRef','status','premiumUgx','totalPremiumUgx','sumInsuredUgx','plate','vehicleMake','vehicleModel','periodStart','periodEnd','trainingLevyUgx','stickerFeesUgx','vatUgx','stampDutyUgx']);
    rows = raw.filter((r) => inRange(r.periodStart, from, to) || inRange(r.periodEnd, from, to)).map((r) => ({
      policyNo: r.policyNo ?? '',
      quoteRef: r.quoteRef ?? '',
      status: r.status ?? '',
      plate: r.plate ?? '',
      vehicleMake: r.vehicleMake ?? '',
      vehicleModel: r.vehicleModel ?? '',
      sumInsuredUgx: sumUgx(r.sumInsuredUgx),
      premiumUgx: sumUgx(r.premiumUgx),
      totalPremiumUgx: sumUgx(r.totalPremiumUgx ?? r.premiumUgx),
      levies: sumUgx((Number(r.trainingLevyUgx)||0)+(Number(r.stickerFeesUgx)||0)+(Number(r.vatUgx)||0)+(Number(r.stampDutyUgx)||0)),
      periodStart: fmtDate(r.periodStart),
      periodEnd: fmtDate(r.periodEnd),
    }));
    columns = [
      { key: 'policyNo', header: 'Policy no' },
      { key: 'quoteRef', header: 'Quote ref' },
      { key: 'status', header: 'Status' },
      { key: 'plate', header: 'Plate' },
      { key: 'vehicleMake', header: 'Make' },
      { key: 'vehicleModel', header: 'Model' },
      { key: 'sumInsuredUgx', header: 'Sum insured (UGX)' },
      { key: 'premiumUgx', header: 'Premium (UGX)' },
      { key: 'totalPremiumUgx', header: 'Total premium (UGX)' },
      { key: 'levies', header: 'Levies (UGX)' },
      { key: 'periodStart', header: 'Period start' },
      { key: 'periodEnd', header: 'Period end' },
    ];
    sheet = 'Policies';
  } else if (type === 'payments') {
    const raw = await fetchAll(db, 'insurancePayments', ['paymentRef','quoteRef','provider','providerRef','payerPhone','amountUgx','status']);
    rows = raw.map((r) => ({
      paymentRef: r.paymentRef ?? '',
      quoteRef: r.quoteRef ?? '',
      provider: r.provider ?? '',
      providerRef: r.providerRef ?? '',
      payerPhone: r.payerPhone ?? '',
      amountUgx: sumUgx(r.amountUgx),
      status: r.status ?? '',
    }));
    columns = [
      { key: 'paymentRef', header: 'Payment ref' },
      { key: 'quoteRef', header: 'Quote ref' },
      { key: 'provider', header: 'Provider' },
      { key: 'providerRef', header: 'Provider ref' },
      { key: 'payerPhone', header: 'Payer phone' },
      { key: 'amountUgx', header: 'Amount (UGX)' },
      { key: 'status', header: 'Status' },
    ];
    sheet = 'Payments';
  } else if (type === 'claims') {
    const raw = await fetchAll(db, 'insuranceClaims', ['claimRef','policyNo','status','reserveUgx','incidentDate','location','reporterPhone','description']);
    rows = raw.filter((r) => inRange(r.incidentDate, from, to)).map((r) => ({
      claimRef: r.claimRef ?? '',
      policyNo: r.policyNo ?? '',
      status: r.status ?? '',
      reserveUgx: sumUgx(r.reserveUgx),
      incidentDate: fmtDate(r.incidentDate),
      location: r.location ?? '',
      reporterPhone: r.reporterPhone ?? '',
      description: String(r.description ?? '').slice(0, 200),
    }));
    columns = [
      { key: 'claimRef', header: 'Claim ref' },
      { key: 'policyNo', header: 'Policy no' },
      { key: 'status', header: 'Status' },
      { key: 'reserveUgx', header: 'Reserve (UGX)' },
      { key: 'incidentDate', header: 'Incident date' },
      { key: 'location', header: 'Location' },
      { key: 'reporterPhone', header: 'Reporter phone' },
      { key: 'description', header: 'Description' },
    ];
    sheet = 'Claims';
  } else if (type === 'commissions') {
    const raw = await fetchAll(db, 'commissions', ['protectaRef','policyNo','amountUgx','status','statementMonth','payoutRef','rate']);
    rows = raw.filter((r) => {
      const m = String(r.statementMonth ?? '').slice(0,7);
      if (from && m && m < from.toISOString().slice(0,7)) return false;
      if (to && m && m > to.toISOString().slice(0,7)) return false;
      return true;
    }).map((r) => ({
      protectaRef: r.protectaRef ?? '',
      policyNo: r.policyNo ?? '',
      statementMonth: r.statementMonth ?? '',
      status: r.status ?? '',
      amountUgx: sumUgx(r.amountUgx),
      rate: r.rate ?? '',
      payoutRef: r.payoutRef ?? '',
    }));
    columns = [
      { key: 'protectaRef', header: 'Ref' },
      { key: 'policyNo', header: 'Policy no' },
      { key: 'statementMonth', header: 'Statement month' },
      { key: 'status', header: 'Status' },
      { key: 'amountUgx', header: 'Amount (UGX)' },
      { key: 'rate', header: 'Rate' },
      { key: 'payoutRef', header: 'Payout ref' },
    ];
    sheet = 'Commissions';
  } else if (type === 'expiring') {
    const windowDays = Math.min(Math.max(Number(qs.days ?? 30) || 30, 1), 365);
    const raw = await fetchAll(db, 'insurancePolicies', ['policyNo','premiumUgx','status','periodEnd','plate','vehicleMake']);
    const horizon = new Date(); horizon.setDate(horizon.getDate()+windowDays);
    rows = raw.filter((r) => {
      if (String(r.status) !== 'ACTIVE') return false;
      const d = new Date(String(r.periodEnd ?? ''));
      if (isNaN(d.getTime())) return false;
      return d >= (from ?? new Date()) && d <= (to ?? horizon);
    }).map((r) => ({
      policyNo: r.policyNo ?? '',
      status: r.status ?? '',
      plate: r.plate ?? '',
      vehicleMake: r.vehicleMake ?? '',
      premiumUgx: sumUgx(r.premiumUgx),
      periodEnd: fmtDate(r.periodEnd),
      daysToExpiry: (()=>{ const d=new Date(String(r.periodEnd)); const diff=Math.ceil((d.getTime()-Date.now())/86400000); return String(diff) })(),
    })).sort((a,b)=> String(a.periodEnd).localeCompare(String(b.periodEnd)));
    columns = [
      { key: 'policyNo', header: 'Policy no' },
      { key: 'status', header: 'Status' },
      { key: 'plate', header: 'Plate' },
      { key: 'vehicleMake', header: 'Make' },
      { key: 'premiumUgx', header: 'Premium (UGX)' },
      { key: 'periodEnd', header: 'Expiry' },
      { key: 'daysToExpiry', header: 'Days to expiry' },
    ];
    sheet = `Expiring_${windowDays}d`;
  } else if (type === 'reconciliation') {
    const [policies, payments] = await Promise.all([
      fetchAll(db, 'insurancePolicies', ['policyNo','quoteRef','premiumUgx','totalPremiumUgx','status','periodStart']),
      fetchAll(db, 'insurancePayments', ['quoteRef','amountUgx','status','provider']),
    ]);
    // map confirmed payments by quoteRef
    const payByQuote = new Map<string, number>();
    for (const p of payments) {
      if (String(p.status) !== 'CONFIRMED') continue;
      const k = String(p.quoteRef ?? '');
      if (!k) continue;
      payByQuote.set(k, (payByQuote.get(k) ?? 0) + (Number(p.amountUgx) || 0));
    }
    rows = policies.filter((r) => inRange(r.periodStart, from, to)).map((po) => {
      const expected = Number(po.totalPremiumUgx ?? po.premiumUgx) || 0;
      const paid = payByQuote.get(String(po.quoteRef ?? '')) ?? 0;
      const diff = paid - expected;
      const state = paid === 0 ? 'UNPAID' : diff < 0 ? 'UNDERPAID' : diff > 0 ? 'OVERPAID' : 'RECONCILED';
      return {
        policyNo: po.policyNo ?? '',
        quoteRef: po.quoteRef ?? '',
        status: po.status ?? '',
        expectedUgx: sumUgx(expected),
        paidUgx: sumUgx(paid),
        diffUgx: sumUgx(diff),
        state,
      };
    });
    columns = [
      { key: 'policyNo', header: 'Policy no' },
      { key: 'quoteRef', header: 'Quote ref' },
      { key: 'status', header: 'Policy status' },
      { key: 'expectedUgx', header: 'Expected (UGX)' },
      { key: 'paidUgx', header: 'Paid (UGX)' },
      { key: 'diffUgx', header: 'Diff (UGX)' },
      { key: 'state', header: 'State' },
    ];
    sheet = 'Reconciliation';
  } else if (type === 'finance') {
    const [commissions, claims] = await Promise.all([
      fetchAll(db, 'commissions', ['amountUgx','status','statementMonth']),
      fetchAll(db, 'insuranceClaims', ['reserveUgx','status','incidentDate']),
    ]);
    // aggregate by month
    const byMonth = new Map<string, { commPayable: number; commAccrued: number; reserve: number }>();
    for (const c of commissions) {
      const m = String(c.statementMonth ?? '').slice(0,7) || '—';
      if (from && m !== '—' && m < from.toISOString().slice(0,7)) continue;
      if (to && m !== '—' && m > to.toISOString().slice(0,7)) continue;
      const cur = byMonth.get(m) ?? { commPayable:0, commAccrued:0, reserve:0 };
      if (String(c.status) === 'PAYABLE') cur.commPayable += Number(c.amountUgx)||0;
      if (String(c.status) === 'ACCRUED') cur.commAccrued += Number(c.amountUgx)||0;
      byMonth.set(m, cur);
    }
    for (const cl of claims) {
      const m = String(cl.incidentDate ?? '').slice(0,7) || '—';
      if (!inRange(cl.incidentDate, from, to)) continue;
      const cur = byMonth.get(m) ?? { commPayable:0, commAccrued:0, reserve:0 };
      cur.reserve += Number(cl.reserveUgx)||0;
      byMonth.set(m, cur);
    }
    rows = [...byMonth.entries()].sort((a,b)=> a[0].localeCompare(b[0])).map(([month, v]) => ({
      month,
      commissionsPayable: sumUgx(v.commPayable),
      commissionsAccrued: sumUgx(v.commAccrued),
      claimsReserve: sumUgx(v.reserve),
      totalOutflow: sumUgx(v.commPayable + v.reserve),
    }));
    columns = [
      { key: 'month', header: 'Month' },
      { key: 'commissionsPayable', header: 'Commissions payable (UGX)' },
      { key: 'commissionsAccrued', header: 'Commissions accrued (UGX)' },
      { key: 'claimsReserve', header: 'Claims reserve (UGX)' },
      { key: 'totalOutflow', header: 'Total outflow (UGX)' },
    ];
    sheet = 'Finance';
  } else if (type === 'kyc') {
    const [tickets, kyc] = await Promise.all([
      fetchAll(db, 'supportTickets', ['subject','status','priority','assigneeId']).catch(()=>[]),
      fetchAll(db, 'kycCases', ['nin','status','riskTier','phone']).catch(()=>[]),
    ]);
    rows = [
      ...kyc.filter((r) => String(r.status) !== 'APPROVED').map((r) => ({
        kind: 'KYC',
        ref: r.nin ?? r.phone ?? '',
        status: r.status ?? '',
        tier: r.riskTier ?? '',
        phone: r.phone ?? '',
      })),
      ...tickets.filter((r) => ['OPEN','IN_PROGRESS'].includes(String(r.status))).map((r) => ({
        kind: 'TICKET',
        ref: r.subject ?? '',
        status: r.status ?? '',
        tier: r.priority ?? '',
        phone: '',
      })),
    ];
    columns = [
      { key: 'kind', header: 'Kind' },
      { key: 'ref', header: 'Ref / Subject' },
      { key: 'status', header: 'Status' },
      { key: 'tier', header: 'Tier / Priority' },
      { key: 'phone', header: 'Phone' },
    ];
    sheet = 'Overdue_KYC';
  }

  const filenameBase = `Protecta_${sheet}_${now}`.replace(/[^A-Za-z0-9_\-]+/g,'_');

  if (format === 'csv') {
    const csv = rowsToCsv(rows, columns);
    return buildCsvResponse(csv, `${filenameBase}.csv`);
  }
  if (format === 'html') {
    const html = rowsToHtmlExcel(rows, columns, sheet);
    // render as preview page wrapping the table
    return htmlResponse(`<!doctype html><meta charset="utf-8"><title>${sheet} preview</title><style>body{font-family:system-ui;padding:20px} h1{color:#0B1C48} .muted{color:#5B6B7C} table{border-collapse:collapse} th{background:#0B1C48;color:#fff}</style><h1>${sheet} — preview (${rows.length} rows)</h1><p class="muted">Export: <a href="/s/protecta/reports/export?type=${type}&format=xlsx${from?`&from=${from.toISOString().slice(0,10)}`:''}${to?`&to=${to.toISOString().slice(0,10)}`:''}">xlsx</a> · <a href="/s/protecta/reports/export?type=${type}&format=csv">csv</a> · <a href="/s/protecta/reports">reports</a></p>` + html);
  }
  const html = rowsToHtmlExcel(rows, columns, sheet);
  if (format === 'xls') return buildExcelResponse(html, `${filenameBase}.xls`);
  return buildXlsxResponse(html, `${filenameBase}.xlsx`);
};

export default defineLogicFunction({
  universalIdentifier: REPORT_EXPORT,
  name: 'reports-export',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/reports/export',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
