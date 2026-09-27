/**
 * Screening report generation.
 *
 * Both the PDF (generateScreenReport) and the printable HTML
 * (generateScreenReportHtml) reproduce the monochrome CHUNGUZA design the
 * retired Python reportlab service produced (backend-python/app/services/
 * report.py, mirroring frontend-mockups/14-printable-report.html):
 *
 *   - brand header + CONFIDENTIAL // REGULATORY REPORT + reference metadata
 *   - title + verdict banner (EDD MANDATORY / REVIEW REQUIRED / CLEAR)
 *   - §1 screened candidate profile
 *   - §2 watchlist findings + sanctions designations + full fact profile
 *   - §3 associated entities & network linkages
 *   - §4 data freshness
 *   - footer with immutable archive line + SHA-256 data seal
 */
import { createHash } from 'node:crypto';
import { amlQuery } from './db.js';
import { formatMatch } from './screen.js';
import { buildReportPdf, type ReportSection } from './reportPdf.js';

function parseJson(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  if (typeof value === 'object') return value as Record<string, unknown>;
  return {};
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Retained for legacy stored reports (payload persisted as a `lines` array). */
export function buildSimplePdf(lines: string[]): Buffer {
  const pageLines = lines.flatMap((line) => {
    const chunks: string[] = [];
    for (let i = 0; i < line.length; i += 90) chunks.push(line.slice(i, i + 90));
    return chunks.length ? chunks : [''];
  });
  const content = [
    'BT',
    '/F1 11 Tf',
    '50 780 Td',
    '14 TL',
    ...pageLines.map((line, i) => (i === 0 ? `(${escapePdf(line)}) Tj` : `T* (${escapePdf(line)}) Tj`)),
    'ET',
  ].join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${Buffer.byteLength(content)} >> stream\n${content}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  ];
  let offset = '%PDF-1.4\n'.length;
  const xref = ['xref', '0 6', '0000000000 65535 f '];
  const body: string[] = [];
  for (const obj of objects) {
    xref.push(`${String(offset).padStart(10, '0')} 00000 n `);
    body.push(obj);
    offset += Buffer.byteLength(obj) + 1;
  }
  const xrefStart = offset;
  const pdf = [
    '%PDF-1.4',
    ...body,
    ...xref,
    'trailer << /Size 6 /Root 1 0 R >>',
    'startxref',
    String(xrefStart),
    '%%EOF',
  ].join('\n');
  return Buffer.from(pdf, 'utf8');
}

// Map OpenSanctions/yente dataset codes to watchlist authority labels.
const AUTHORITY_MAP: Record<string, string> = {
  us_ofac: 'OFAC (USA)', un_sc: 'UN Security Council', eu_fsf: 'EU Consolidated',
  eu_csdp: 'EU CSDP', gb_hmt_sanctions: 'UK HMT (UK)', gb_ofsi: 'UK OFSI (UK)',
  us_bis_entity: 'US BIS (USA)', us_ssi_list: 'US OFAC SSI', ru_ssi: 'Russia SSI',
  cn_mofcom: 'PRC MOFCOM', un_1257: 'UN 1257 (CAR)', un_751: 'UN 751 (Somalia)',
  un_1970: 'UN 1970 (Libya)', un_2653: 'UN 2653 (DRC)', un_1718: 'UN 1718 (DPRK)',
  un_2231: 'UN 2231 (Iran)',
};

function authorityLabel(dataset: string): string {
  const key = dataset.toLowerCase();
  for (const [code, label] of Object.entries(AUTHORITY_MAP)) {
    if (key === code || key.startsWith(`${code}_`) || key.startsWith(`${code}.`)) return label;
  }
  const parts = key.replace(/-/g, '_').split('_');
  if (parts.length >= 2) return `${parts[0].toUpperCase()}: ${parts.slice(1).map((p) => p[0]?.toUpperCase() + p.slice(1)).join(' ')}`;
  return key.toUpperCase();
}

function clean(value: unknown, dash = '-'): string {
  if (value === null || value === undefined) return dash;
  if (Array.isArray(value)) value = value.filter((v) => v !== null && v !== undefined && v !== '').join(', ');
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || dash;
}

function verdictFor(risk: string, sanctions: number, pep: number): { main: string; sub: string; badge: string } {
  const r = (risk || 'Clear').toLowerCase();
  if (r === 'high' || r === 'critical') {
    const main = r === 'critical'
      ? 'CRITICAL MATCH: IMMEDIATE ACTION REQUIRED'
      : 'CONFIRMED MATCH: HIGH RISK SANCTIONS HIT';
    const parts: string[] = [];
    if (sanctions) parts.push('sanctions');
    if (pep) parts.push('PEP');
    const src = parts.join(' / ') || 'watchlist';
    return {
      main,
      sub: `Subject matches ${src} records above the configured threshold. Transaction / relationship flagged for immediate compliance review.`,
      badge: 'EDD MANDATORY',
    };
  }
  if (r === 'medium') {
    return {
      main: 'MATCH FOUND: MEDIUM RISK - HUMAN REVIEW REQUIRED',
      sub: 'One or more candidate matches were found; enhanced due diligence is required before processing.',
      badge: 'REVIEW REQUIRED',
    };
  }
  if (r === 'low') {
    return {
      main: 'LOW RISK: NO MATERIAL MATCH FOUND',
      sub: 'No candidate reached the flag threshold; residual identity risk remains low.',
      badge: 'LOW RISK',
    };
  }
  return {
    main: 'NO MATCH FOUND: CLEAR RESULT',
    sub: 'No sanctions, PEP, or watchlist matches were found above the configured threshold.',
    badge: 'CLEAR',
  };
}

function factPairs(m: Record<string, unknown>): Array<[string, string]> {
  const str = (v: unknown) => clean(v, '');
  const facts: Array<[string, string]> = [
    ['Designated Target', clean(m.caption)],
    ['Entity Type', str(m.entity_type)],
    ['Risk Topics', clean(((m.topics as unknown[]) || []).map((t) => String(t).replace(/_/g, ' '))).replace(/,/g, ' · ') || ''],
    ['Aliases / Transliterations', clean(m.aliases)],
    ['Date of Birth', clean(m.birth_dates)],
    ['Place of Birth', clean(m.birth_place)],
    ['Gender', clean(m.gender)],
    ['Positions Held', clean(m.positions)],
    ['Nationality', clean(m.nationalities)],
    ['Citizenship', clean(m.citizenships)],
    ['Classification', clean(m.classification)],
    ['Political Association', clean(m.political)],
    ['Education', clean(m.education)],
    ['Email', clean(m.emails)],
    ['Phone', clean(m.phones)],
  ];
  const details = (m.details as Record<string, { label: string; values: unknown[] }>) || {};
  const alreadyShown = new Set([
    'name', 'alias', 'weakAlias', 'birthDate', 'birthPlace', 'gender', 'nationality',
    'citizenship', 'classification', 'political', 'education', 'email', 'phone',
  ]);
  for (const [key, section] of Object.entries(details)) {
    if (alreadyShown.has(key)) continue;
    if (!section || !Array.isArray(section.values) || !section.values.length) continue;
    facts.push([section.label || key, clean(section.values)]);
  }
  const descriptions = m.descriptions as unknown[];
  if (Array.isArray(descriptions) && descriptions.length) facts.push(['Descriptions', clean(descriptions)]);
  const datasets = m.datasets as unknown[];
  if (Array.isArray(datasets) && datasets.length) facts.push(['Source Datasets', clean(datasets)]);
  const sourceLinks = m.source_links as Array<{ source: string; url: string }> | undefined;
  if (sourceLinks?.length) facts.push(['Source Links', sourceLinks.map((l) => (l.url ? `${l.source} (${l.url})` : l.source)).join(' · ')]);
  return facts.filter((f) => f[1] !== '' && f[1] !== '-');
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  sanction: 'Sanction designation', family: 'Family', position: 'Position held',
  associate: 'Associate', membership: 'Membership', directorship: 'Directorship',
  employment: 'Employment', ownership: 'Ownership', representation: 'Representation',
  identification: 'Identification', address: 'Address', link: 'Other link',
};

export async function generateScreenReport(reference: string): Promise<{ bytes: Buffer; filename: string }> {
  const { rows } = await amlQuery<{
    input_payload: unknown;
    yente_result: unknown;
    risk_level: string;
    match_classification: unknown;
    match_found: boolean;
    requested_by: string | null;
    created_at: Date;
    max_score: number | null;
  }>(
    `SELECT input_payload, yente_result, risk_level, match_classification,
            match_found, requested_by, created_at, max_score
     FROM aml.screening_requests WHERE reference = $1`,
    [reference],
  );
  const row = rows[0];
  if (!row) {
    const err = new Error('Screening not found') as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  const payload = parseJson(row.input_payload);
  const yente = parseJson(row.yente_result);
  const matches = (Array.isArray(yente.matches) ? yente.matches : []) as Array<Record<string, unknown>>;
  const relationships = (Array.isArray(yente.relationships) ? yente.relationships : []) as Array<Record<string, unknown>>;
  const formatted = matches.map(formatMatch);

  const sanctions = formatted.filter((m) => (m.risk_categories as string[] || []).includes('sanction')).length;
  const pep = formatted.filter((m) => (m.risk_categories as string[] || []).includes('pep')).length;
  const threshold = Number(payload.threshold || 0.82);
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const verdict = verdictFor(row.risk_level, sanctions, pep);

  const sections: ReportSection[] = [];

  sections.push({
    heading: '§ 1. Screened Remittance Candidate Profile (Client Screened)',
    right: `Screening ID: ${reference}`,
    kind: 'kv',
    pairs: [
      ['Primary Candidate Name', clean(payload.name), 'Entity Type', clean(payload.entity_type || 'auto')],
      ['Date of Birth (DOB)', clean(payload.date_of_birth || 'Not specified'), 'Nationality', clean(payload.nationality || 'Not specified')],
      ['Country', clean(payload.country || 'Not specified'), 'Registration Number', clean(payload.registration_number || 'Not specified')],
      ['Jurisdiction', clean(payload.jurisdiction || 'Not specified'), 'Aliases', clean(payload.aliases || 'None')],
      ['Requested By', clean(row.requested_by), 'Match Threshold', `${(threshold * 100).toFixed(0)}%`],
    ],
  });

  const maxScore = row.max_score != null ? row.max_score : Math.max(0, ...formatted.map((m) => Number(m.score || 0)));
  sections.push({
    heading: '§ 2. Sanctions Watchlist Findings & Transliteration Breakdown (Hits)',
    right: `Score: ${(maxScore * 100).toFixed(2)}% (Threshold ${(threshold * 100).toFixed(2)}%)`,
    kind: 'table',
    columns: ['Watchlist Authority', 'Designated Target Name', 'Program / Legal Authority', 'Match Score (%)', 'Match Classification'],
    widths: [0.16, 0.26, 0.22, 0.14, 0.22],
    rows: formatted.slice(0, 20).map((m) => {
      const datasets = (m.datasets as string[]) || [];
      const authority = [...new Set(datasets.map(authorityLabel))].join(', ') || 'Watchlist';
      const program = ((m.risk_categories as string[]) || []).join(', ').replace(/_/g, ' ').toUpperCase() || 'General watchlist record';
      const classification = ((m.risk_categories as string[]) || []).includes('sanction') ? 'Direct Identity Match' : 'Candidate Match';
      return [
        authority,
        `${clean(m.caption)}\n${clean(m.entity_id)}`,
        program,
        `${(Number(m.score || 0) * 100).toFixed(2)}%`,
        classification,
      ];
    }),
  });

  for (const [i, m] of formatted.entries()) {
    const facts = factPairs(m);
    if (!facts.length) continue;
    sections.push({
      heading: `Match ${i + 1}: ${clean(m.caption)}`,
      right: clean(m.entity_id),
      kind: 'table',
      columns: ['Field', 'Value'],
      widths: [0.24, 0.76],
      rows: facts.map(([k, v]) => [k, v]),
    });
  }

  const sanRows: string[][] = [];
  for (const m of formatted) {
    for (const s of (m.sanctions as Array<Record<string, unknown>>) || []) {
      sanRows.push([
        clean(s.authority),
        clean(s.program),
        clean(s.country).toUpperCase(),
        `${clean(s.start_date)} -> ${clean(s.end_date)}`,
        clean(s.reason),
      ]);
    }
  }
  if (sanRows.length) {
    sections.push({
      heading: 'Sanctions Designations',
      kind: 'table',
      columns: ['Sanctioning Authority', 'Program / Legal Basis', 'Country', 'Duration', 'Reason'],
      widths: [0.18, 0.22, 0.1, 0.16, 0.34],
      rows: sanRows,
    });
  }

  sections.push({
    heading: '§ 3. Associated Entities & Watchlist Network Linkages (Hits)',
    kind: 'table',
    columns: ['Subject', 'Relationship', 'Associated Entity', 'Risk Category', 'Source'],
    widths: [0.18, 0.24, 0.24, 0.14, 0.2],
    rows: relationships.slice(0, 40).map((r) => {
      const type = String(r.relationship_type || 'link');
      const relLabel = RELATIONSHIP_LABELS[type] || type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Related';
      const detail = [relLabel];
      const subtype = String(r.relationship_subtype || '').trim();
      if (subtype && subtype.toLowerCase() !== relLabel.toLowerCase()) detail.push(subtype);
      if (r.start_date || r.end_date) detail.push(`${clean(r.start_date, '?')} -> ${clean(r.end_date, 'present')}`);
      if (r.authority) detail.push(`Authority: ${clean(r.authority)}`);
      if (r.program) detail.push(`Program: ${clean(r.program)}`);
      return [
        clean(r.person),
        detail.join('\n'),
        `${clean(r.entity_name)}\n${clean(r.entity_id, '')}`,
        ((r.risk_categories as string[]) || []).join(', ').replace(/_/g, ' ').toUpperCase(),
        clean(r.source),
      ];
    }),
  });

  const freshness = await getFreshness();
  sections.push({
    heading: '§ 4. Data Freshness & Source Verification',
    kind: 'kv',
    pairs: [
      ['Dataset Version', clean(freshness.dataset_version || 'Unknown'), 'Last Successful Sync', clean(freshness.last_successful_sync || 'Never')],
    ],
  });

  const seal = createHash('sha256')
    .update(JSON.stringify({ reference, query: payload, summary: { risk: row.risk_level, sanctions, pep }, matches: formatted, relationships, generated: generatedAt }, null, 0))
    .digest('hex');

  const bytes = buildReportPdf({
    title: 'AML / Sanctions Screening & Due Diligence Report',
    subtitle: 'Immutable compliance determination under FATF Recommendation 16 (Wire Transfer Rule) and Bank of Uganda Sanctions Mandates.',
    reference,
    generatedAt,
    requestedBy: row.requested_by || '-',
    verdict,
    sections,
    seal,
  });
  return { bytes, filename: `${reference}_report.pdf` };
}

async function getFreshness(): Promise<{ dataset_version: string | null; last_successful_sync: string | null }> {
  try {
    const { getDataFreshness } = await import('./audit.js');
    const data = await getDataFreshness();
    return {
      dataset_version: data.dataset_version,
      last_successful_sync: data.last_successful_sync instanceof Date 
        ? data.last_successful_sync.toISOString() 
        : data.last_successful_sync,
    };
  } catch {
    return { dataset_version: null, last_successful_sync: null };
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function generateScreenReportHtml(reference: string): Promise<{ html: string; filename: string }> {
  const { rows } = await amlQuery<{
    input_payload: unknown;
    yente_result: unknown;
    risk_level: string;
    match_found: boolean;
    requested_by: string | null;
    created_at: Date;
    max_score: number | null;
  }>(
    `SELECT input_payload, yente_result, risk_level, match_found, requested_by, created_at, max_score
     FROM aml.screening_requests WHERE reference = $1`,
    [reference],
  );
  const row = rows[0];
  if (!row) {
    const err = new Error('Screening not found') as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  const payload = parseJson(row.input_payload);
  const yente = parseJson(row.yente_result);
  const matches = (Array.isArray(yente.matches) ? yente.matches : []) as Array<Record<string, unknown>>;
  const relationships = (Array.isArray(yente.relationships) ? yente.relationships : []) as Array<Record<string, unknown>>;
  const formatted = matches.map(formatMatch);
  const sanctions = formatted.filter((m) => (m.risk_categories as string[] || []).includes('sanction')).length;
  const pep = formatted.filter((m) => (m.risk_categories as string[] || []).includes('pep')).length;
  const threshold = Number(payload.threshold || 0.82);
  const verdict = verdictFor(row.risk_level, sanctions, pep);
  const maxScore = row.max_score != null ? row.max_score : Math.max(0, ...formatted.map((m) => Number(m.score || 0)));

  const factsHtml = formatted
    .map((m) => {
      const facts = factPairs(m);
      const rows = facts.map(([k, v]) => `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${escapeHtml(v)}</td></tr>`).join('');
      const san = ((m.sanctions as Array<Record<string, unknown>>) || [])
        .map((s) => `<tr><td>${escapeHtml(clean(s.authority))}</td><td>${escapeHtml(clean(s.program))}</td><td>${escapeHtml(clean(s.country))}</td><td>${escapeHtml(clean(s.start_date))}</td><td>${escapeHtml(clean(s.reason))}</td></tr>`)
        .join('');
      return `
      <div class="match-block">
        <div class="match-title"><b>${escapeHtml(clean(m.caption))}</b> · score ${escapeHtml(String(m.score))} · ${escapeHtml(((m.risk_categories as string[]) || []).join(', '))} · ${escapeHtml(clean(m.entity_id))}</div>
        <table class="doc-table"><tbody>${rows}</tbody></table>
        ${san ? `<table class="doc-table"><thead><tr><th>Authority</th><th>Program</th><th>Country</th><th>From</th><th>Reason</th></tr></thead><tbody>${san}</tbody></table>` : ''}
      </div>`;
    })
    .join('\n');

  const matchRows = formatted.slice(0, 20).map((m) => {
    const authority = [...new Set(((m.datasets as string[]) || []).map(authorityLabel))].join(', ') || 'Watchlist';
    const program = ((m.risk_categories as string[]) || []).join(', ').replace(/_/g, ' ').toUpperCase() || 'General watchlist record';
    const classification = ((m.risk_categories as string[]) || []).includes('sanction') ? 'Direct Identity Match' : 'Candidate Match';
    return `<tr><td><b>${escapeHtml(authority)}</b></td><td>${escapeHtml(clean(m.caption))}<div class="id">${escapeHtml(clean(m.entity_id))}</div></td><td>${escapeHtml(program)}</td><td>${(Number(m.score || 0) * 100).toFixed(2)}%</td><td>${escapeHtml(classification)}</td></tr>`;
  }).join('\n');

  const relRows = relationships.slice(0, 40).map((r) => {
    const type = String(r.relationship_type || 'link');
    const relLabel = RELATIONSHIP_LABELS[type] || type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Related';
    return `<tr><td>${escapeHtml(clean(r.person))}</td><td>${escapeHtml(relLabel)}${r.relationship_subtype ? `<div class="id">${escapeHtml(clean(r.relationship_subtype))}</div>` : ''}</td><td>${escapeHtml(clean(r.entity_name))}<div class="id">${escapeHtml(clean(r.entity_id))}</div></td><td>${escapeHtml(((r.risk_categories as string[]) || []).join(', '))}</td><td>${escapeHtml(clean(r.source))}</td></tr>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Screening report · ${escapeHtml(reference)}</title>
<style>
  :root{--ink:#000;--grey:#333;--rule:#000}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Geist,'Helvetica Neue',Arial,sans-serif;background:#fff;color:#000;font-size:12.5px;line-height:1.5;-webkit-font-smoothing:antialiased}
  .screen-wrapper{max-width:960px;margin:0 auto;padding:24px 20px 80px}
  .report-document{background:#fff;color:#000;padding:48px 56px;border:1px solid #000;position:relative;overflow:hidden}
  .watermark{position:absolute;top:45%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-family:'JetBrains Mono',ui-monospace,monospace;font-size:72px;font-weight:800;letter-spacing:.15em;color:rgba(0,0,0,.05);pointer-events:none;text-transform:uppercase;white-space:nowrap}
  .doc-header{display:grid;grid-template-columns:1fr auto;gap:20px;padding-bottom:20px;border-bottom:2px solid #000;margin-bottom:24px}
  .doc-brand{display:flex;align-items:center;gap:12px;font-family:'JetBrains Mono',ui-monospace,monospace;font-weight:700;font-size:18px;color:#000}
  .doc-brand-mark{width:22px;height:22px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:2px}
  .doc-brand-mark span{background:#000}
  .doc-brand-mark span:nth-child(2),.doc-brand-mark span:nth-child(3){background:#fff}
  .doc-meta-block{text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;color:#333;line-height:1.5}
  .doc-classification{font-weight:700;font-size:10px;color:#000}
  .doc-ref{font-size:13px;font-weight:700;color:#000}
  .doc-title{font-size:22px;font-weight:700;color:#000;letter-spacing:-.01em;margin-bottom:4px}
  .doc-subtitle{font-size:12.5px;color:#333;margin-bottom:20px}
  .verdict-banner{border-bottom:1px solid #000;padding:0 0 16px;margin-bottom:24px;display:grid;grid-template-columns:1fr auto;gap:16px;align-items:flex-start}
  .verdict-main{font-size:15px;font-weight:700;color:#000;margin-bottom:3px}
  .verdict-sub{font-size:12px;color:#333}
  .verdict-badge{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:.05em}
  .doc-sec{margin-bottom:24px}
  .doc-sec-h{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#000;border-bottom:1px solid #000;padding-bottom:6px;margin-bottom:12px;display:flex;justify-content:space-between}
  .doc-table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px}
  .doc-table th{background:transparent;color:#000;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;text-transform:uppercase;letter-spacing:.06em;padding:7px 10px;border:1px solid #000;text-align:left}
  .doc-table td{padding:7px 10px;border:1px solid #000;vertical-align:top;color:#000}
  .doc-table .k{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;font-weight:700;width:30%}
  .doc-table .id{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;color:#333;margin-top:2px}
  .match-title{font-weight:700;margin:6px 0;font-size:12.5px}
  .doc-footer{margin-top:24px;padding-top:14px;border-top:1px solid #000;display:flex;justify-content:space-between;align-items:center;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;color:#333}
  .seal{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:8px;color:#333;margin-top:4px;word-break:break-all}
  @media print{@page{size:A4 portrait;margin:12mm 15mm}.screen-wrapper{padding:0}.report-document{border:none;padding:0}}
</style>
</head>
<body>
<div class="screen-wrapper">
  <div class="report-document">
    <div class="watermark">STRICTLY CONFIDENTIAL</div>
    <header class="doc-header">
      <div>
        <div class="doc-brand"><div class="doc-brand-mark"><span></span><span></span><span></span><span></span></div>CHUNGUZA AML INTELLIGENCE</div>
        <div style="font-size:11.5px;color:#333;margin-top:4px">Global AML &amp; Sanctions Compliance Department</div>
      </div>
      <div class="doc-meta-block">
        <div class="doc-classification">CONFIDENTIAL // REGULATORY REPORT</div>
        <div class="doc-ref">REF: ${escapeHtml(reference)}</div>
        <div>Generated: ${escapeHtml(new Date(row.created_at).toISOString().replace('T', ' ').slice(0, 16))} UTC</div>
        <div>Requested by: ${escapeHtml(row.requested_by || '-')}</div>
      </div>
    </header>
    <h1 class="doc-title">AML / Sanctions Screening &amp; Due Diligence Report</h1>
    <div class="doc-subtitle">Immutable compliance determination under FATF Recommendation 16 (Wire Transfer Rule) and Bank of Uganda Sanctions Mandates.</div>
    <div class="verdict-banner">
      <div>
        <div class="verdict-main">${escapeHtml(verdict.main)}</div>
        <div class="verdict-sub">${escapeHtml(verdict.sub)}</div>
      </div>
      <div class="verdict-badge">${escapeHtml(verdict.badge)}</div>
    </div>
    <div class="doc-sec">
      <div class="doc-sec-h"><span>§ 1. Screened Remittance Candidate Profile (Client Screened)</span><span>Screening ID: ${escapeHtml(reference)}</span></div>
      <table class="doc-table">
        <tr><td class="k">Primary Candidate Name</td><td class="v">${escapeHtml(clean(payload.name))}</td><td class="k">Entity Type</td><td class="v">${escapeHtml(clean(payload.entity_type || 'auto'))}</td></tr>
        <tr><td class="k">Date of Birth (DOB)</td><td class="v">${escapeHtml(clean(payload.date_of_birth || 'Not specified'))}</td><td class="k">Nationality</td><td class="v">${escapeHtml(clean(payload.nationality || 'Not specified'))}</td></tr>
        <tr><td class="k">Country</td><td class="v">${escapeHtml(clean(payload.country || 'Not specified'))}</td><td class="k">Registration</td><td class="v">${escapeHtml(clean(payload.registration_number || 'Not specified'))}</td></tr>
        <tr><td class="k">Requested By</td><td class="v">${escapeHtml(clean(row.requested_by))}</td><td class="k">Match Threshold</td><td class="v">${(threshold * 100).toFixed(0)}%</td></tr>
      </table>
    </div>
    <div class="doc-sec">
      <div class="doc-sec-h"><span>§ 2. Sanctions Watchlist Findings &amp; Transliteration Breakdown (Hits)</span><span>Score: ${(maxScore * 100).toFixed(2)}% (Threshold ${(threshold * 100).toFixed(2)}%)</span></div>
      <table class="doc-table">
        <thead><tr><th>Watchlist Authority</th><th>Designated Target Name</th><th>Program / Legal Authority</th><th>Match Score</th><th>Classification</th></tr></thead>
        <tbody>${matchRows || '<tr><td colspan="5">No candidates above the threshold.</td></tr>'}</tbody>
      </table>
      ${factsHtml}
    </div>
    <div class="doc-sec">
      <div class="doc-sec-h"><span>§ 3. Associated Entities &amp; Watchlist Network Linkages (Hits)</span></div>
      <table class="doc-table">
        <thead><tr><th>Subject</th><th>Relationship</th><th>Associated Entity</th><th>Risk Category</th><th>Source</th></tr></thead>
        <tbody>${relRows || '<tr><td colspan="5">No relationships identified.</td></tr>'}</tbody>
      </table>
    </div>
    <div class="doc-sec">
      <div class="doc-sec-h"><span>§ 4. Data Freshness &amp; Source Verification</span></div>
      <p style="font-size:12px;color:#333">Automated findings are not a determination of guilt. Identity and relationship findings require analyst verification.</p>
    </div>
    <footer class="doc-footer">
      <div>CHUNGUZA COMPLIANCE ARCHIVE · IMMUTABLE REGULATORY RECORD</div>
      <div>FATF REC. 16 · DO NOT ALTER</div>
    </footer>
  </div>
</div>
</body>
</html>`;
  return { html, filename: `${reference}_report.html` };
}
