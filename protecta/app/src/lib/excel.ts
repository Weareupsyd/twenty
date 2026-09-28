// Simple Excel helpers — no extra deps. Excel opens HTML tables as .xls and CSV as .csv.
// For .xlsx we also serve HTML with openxml mime and .xlsx extension — Excel warns but opens.
// For strict CSV, we use RFC 4180.

import { Response } from 'twenty-sdk/logic-function';

export type Column = { key: string; header: string; format?: (v: unknown, row: Record<string, unknown>) => string };

const csvEscape = (value: string): string => {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

export const rowsToCsv = (rows: Record<string, unknown>[], columns: Column[]): string => {
  const header = columns.map((c) => csvEscape(c.header)).join(',');
  const lines = rows.map((row) =>
    columns
      .map((c) => {
        const raw = c.format ? c.format(row[c.key], row) : row[c.key];
        const s = raw === null || raw === undefined ? '' : String(raw);
        return csvEscape(s);
      })
      .join(','),
  );
  return [header, ...lines].join('\r\n');
};

export const rowsToHtmlExcel = (rows: Record<string, unknown>[], columns: Column[], sheetName = 'Sheet1'): string => {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const headerRow = columns.map((c) => `<th style="background:#0B1C48;color:#fff;font-weight:700;padding:6px;border:1px solid #BCDCE7">${esc(c.header)}</th>`).join('');
  const bodyRows = rows
    .map(
      (row) =>
        `<tr>${columns
          .map((c) => {
            const raw = c.format ? c.format(row[c.key], row) : row[c.key];
            const s = raw === null || raw === undefined ? '' : String(raw);
            return `<td style="padding:4px 6px;border:1px solid #E6ECF2">${esc(s)}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  return `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${esc(sheetName)}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--><style>table{border-collapse:collapse}th,td{font-family:Calibri,Arial,sans-serif;font-size:11pt}</style></head><body><table><thead><tr>${headerRow}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`;
};

export const sumUgx = (n: unknown): string => {
  const num = typeof n === 'string' ? Number(n) : (n as number);
  return Number.isFinite(num) ? num.toLocaleString('en-UG') : String(n ?? '');
};

export const fmtDate = (v: unknown): string => {
  if (!v) return '';
  const s = String(v);
  // keep ISO date as is, slice to 10 chars
  return s.slice(0, 10);
};

export const buildExcelResponse = (html: string, filename: string): Response =>
  new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, max-age=60',
    },
  });

export const buildCsvResponse = (csv: string, filename: string): Response =>
  new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, max-age=60',
    },
  });

// For true .xlsx mime when serving HTML-as-xlsx (Excel will still open with warning)
export const buildXlsxResponse = (html: string, filename: string): Response =>
  new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, max-age=60',
    },
  });
