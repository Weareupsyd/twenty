/**
 * Minimal PDF 1.4 writer that reproduces the monochrome CHUNGUZA report
 * design (the reportlab layout this port replaced). No external PDF library:
 * text, rules, grid rectangles and a rotated watermark are emitted as raw PDF
 * operators. Base-14 fonts only (Helvetica / Courier), so non-Latin-1 glyphs
 * are replaced with "?" rather than corrupting the file.
 */

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN_L = 51;
const MARGIN_R = 51;
const MARGIN_T = 45;
const MARGIN_B = 51;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

type FontKey = 'H' | 'HB' | 'M' | 'MB';
const FONT_RES: Record<FontKey, string> = { H: '/F1', HB: '/F2', M: '/F3', MB: '/F4' };

function esc(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .split('')
    .map((c) => (c.charCodeAt(0) > 255 ? '?' : c))
    .join('');
}

function charW(ch: string, font: FontKey, size: number): number {
  if (font === 'M' || font === 'MB') return 0.6 * size;
  if (ch === ' ') return 0.28 * size;
  return 0.5 * size;
}

function measure(s: string, font: FontKey, size: number): number {
  let w = 0;
  for (const ch of s) w += charW(ch, font, size);
  return w;
}

function wrap(text: string, font: FontKey, size: number, maxW: number): string[] {
  const source = String(text ?? '').replace(/\r/g, '');
  const lines: string[] = [];
  for (const raw of source.split('\n')) {
    if (!raw) {
      lines.push('');
      continue;
    }
    const words = raw.split(' ');
    let cur = '';
    for (const word of words) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (!cur || measure(candidate, font, size) <= maxW) cur = candidate;
      else {
        lines.push(cur);
        cur = word;
      }
    }
    lines.push(cur);
  }
  return lines.length ? lines : [''];
}

export type ReportSection = {
  heading: string;
  right?: string;
  kind: 'kv' | 'table' | 'para';
  pairs?: Array<[string, string, string?, string?]>;
  columns?: string[];
  widths?: number[];
  rows?: string[][];
  paragraphs?: string[];
};

export type ReportDocInput = {
  title: string;
  subtitle: string;
  reference: string;
  generatedAt: string;
  requestedBy: string;
  verdict: { main: string; sub: string; badge: string };
  sections: ReportSection[];
  seal: string;
  watermark?: string;
};

class Page {
  ops: string[] = [];
  y = PAGE_H - MARGIN_T;
}

export function buildReportPdf(input: ReportDocInput): Buffer {
  const pages: Page[] = [];
  const cur = () => pages[pages.length - 1];
  const watermark = input.watermark || 'STRICTLY CONFIDENTIAL';

  const newPage = () => {
    const p = new Page();
    pages.push(p);
    // Watermark behind the page content.
    const w = measure(watermark, 'HB', 60);
    p.ops.push(
      'q',
      '0.7071 -0.7071 0.7071 0.7071 297.64 420.94 cm',
      `BT ${FONT_RES.HB} 60 Tf 0.96 g ${(-w / 2).toFixed(2)} 0 Td (${esc(watermark)}) Tj ET`,
      'Q',
    );
  };

  const line = (x1: number, y1: number, x2: number, y2: number, w = 0.5) => {
    cur().ops.push(`${w.toFixed(2)} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  };

  const text = (x: number, y: number, s: string, font: FontKey, size: number, align: 'left' | 'right' = 'left') => {
    let tx = x;
    if (align === 'right') tx = x - measure(s, font, size);
    cur().ops.push(`BT ${FONT_RES[font]} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td (${esc(s)}) Tj ET`);
  };

  const ensure = (need: number) => {
    if (cur().y - need < MARGIN_B) newPage();
  };

  // Draw a wrapped text block; returns the new cursor y.
  const block = (x: number, s: string, font: FontKey, size: number, maxW: number, leading: number, align: 'left' | 'right' = 'left'): number => {
    const lines = wrap(s, font, size, maxW);
    let y = cur().y;
    for (const l of lines) {
      ensure(leading);
      y = cur().y;
      text(x, y, l, font, size, align);
      y -= leading;
      cur().y = y;
    }
    return y;
  };

  const sectionHeading = (heading: string, right?: string) => {
    ensure(30);
    const y0 = cur().y;
    text(MARGIN_L, y0, heading, 'MB', 10.5);
    if (right) text(MARGIN_L + CONTENT_W, y0, right, 'M', 8.5, 'right');
    line(MARGIN_L, y0 - 7, MARGIN_L + CONTENT_W, y0 - 7, 0.8);
    cur().y = y0 - 16;
  };

  const drawCell = (x: number, top: number, w: number, h: number, s: string, font: FontKey, size: number, align: 'left' | 'right' = 'left') => {
    // Vertically centre-ish: draw the first line at the top with padding.
    const lines = wrap(s, font, size, w - 12);
    let ty = top - 6;
    for (const l of lines) {
      text(x + 6, ty, l, font, size, align === 'right' ? 'right' : 'left');
      ty -= 11;
    }
  };

  const cellHeight = (s: string, font: FontKey, size: number, w: number): number => {
    const n = wrap(s, font, size, w - 12).length;
    return Math.max(16, n * 11 + 10);
  };

  const drawTable = (columns: string[], rows: string[][], widths: number[], boldCols: boolean[] = []) => {
    const colW = widths.map((wd) => wd * CONTENT_W);
    const headerH = 18;
    ensure(headerH + 20);
    const top = cur().y;
    // header
    let hx = MARGIN_L;
    columns.forEach((c, i) => {
      drawCell(hx, top, colW[i], headerH, c, 'MB', 8.5);
      hx += colW[i];
    });
    line(MARGIN_L, top - headerH, MARGIN_L + CONTENT_W, top - headerH, 0.7);
    let rowTop = top - headerH;
    for (const row of rows) {
      const heights = row.map((cell, i) => cellHeight(cell, i === 0 ? 'HB' : 'H', 8.5, colW[i]));
      const rh = Math.max(...heights);
      ensure(rh);
      if (cur().y !== rowTop) {
        // page break: redraw header
        rowTop = cur().y;
        let hx2 = MARGIN_L;
        columns.forEach((c, i) => {
          drawCell(hx2, rowTop, colW[i], headerH, c, 'MB', 8.5);
          hx2 += colW[i];
        });
        line(MARGIN_L, rowTop - headerH, MARGIN_L + CONTENT_W, rowTop - headerH, 0.7);
        rowTop -= headerH;
      }
      let cx = MARGIN_L;
      row.forEach((cell, i) => {
        drawCell(cx, rowTop, colW[i], rh, cell, boldCols[i] ? 'HB' : 'H', 8.5);
        cx += colW[i];
      });
      // grid lines
      line(MARGIN_L, rowTop - rh, MARGIN_L + CONTENT_W, rowTop - rh, 0.4);
      rowTop -= rh;
    }
    // side borders
    let cy = top;
    line(MARGIN_L, cy, MARGIN_L, rowTop, 0.5);
    line(MARGIN_L + CONTENT_W, cy, MARGIN_L + CONTENT_W, rowTop, 0.5);
    cur().y = rowTop - 10;
  };

  const drawKv = (pairs: Array<[string, string, string?, string?]>) => {
    const fourCol = pairs.some((p) => p.length >= 4 && (p[2] !== undefined || p[3] !== undefined));
    if (fourCol) {
      const cols = ['', '', '', ''];
      const rows = pairs.map((p) => [p[0] || '', p[1] || '', p[2] || '', p[3] || '']);
      drawTable(cols, rows, [0.2, 0.3, 0.2, 0.3], [true, false, true, false]);
    } else {
      const cols = ['', ''];
      const rows = pairs.map((p) => [p[0] || '', p[1] || '']);
      drawTable(cols, rows, [0.25, 0.75], [true, false]);
    }
  };

  // ── Header ────────────────────────────────────────────────
  newPage(); // first page (with watermark)
  const headerTop = cur().y;
  // 2x2 brand mark
  const mk = 11;
  cur().ops.push(
    `0 g ${MARGIN_L.toFixed(2)} ${(headerTop - mk).toFixed(2)} ${(mk / 2).toFixed(2)} ${(mk / 2).toFixed(2)} re f`,
    `0 g ${(MARGIN_L + mk / 2).toFixed(2)} ${(headerTop - mk + mk / 2).toFixed(2)} ${(mk / 2).toFixed(2)} ${(mk / 2).toFixed(2)} re f`,
  );
  text(MARGIN_L + mk + 8, headerTop - 10, 'CHUNGUZA AML INTELLIGENCE', 'MB', 15);
  text(MARGIN_L + mk + 8, headerTop - 24, 'Global AML & Sanctions Compliance Department', 'H', 8.5);
  text(MARGIN_L + CONTENT_W, headerTop - 8, 'CONFIDENTIAL // REGULATORY REPORT', 'MB', 7.5, 'right');
  text(MARGIN_L + CONTENT_W, headerTop - 21, `REF: ${input.reference}`, 'MB', 11, 'right');
  text(MARGIN_L + CONTENT_W, headerTop - 34, `Generated: ${input.generatedAt}`, 'M', 8, 'right');
  text(MARGIN_L + CONTENT_W, headerTop - 45, `Requested by: ${input.requestedBy}`, 'M', 8, 'right');
  line(MARGIN_L, headerTop - 52, MARGIN_L + CONTENT_W, headerTop - 52, 1.6);
  cur().y = headerTop - 66;

  // ── Title + verdict ────────────────────────────────────────
  ensure(80);
  let y = cur().y;
  y = block(MARGIN_L, input.title, 'HB', 17, CONTENT_W, 20);
  y -= 2;
  y = block(MARGIN_L, input.subtitle, 'H', 9, CONTENT_W, 13);
  y -= 8;
  const verdictLeft = wrap(`${input.verdict.main}\n${input.verdict.sub}`, 'HB', 11, CONTENT_W * 0.74);
  const vTop = y;
  for (const l of verdictLeft) {
    text(MARGIN_L, y, l, 'HB', l === verdictLeft[0] ? 11 : 8.5, 'left');
    y -= l === verdictLeft[0] ? 15 : 12;
  }
  text(MARGIN_L + CONTENT_W, vTop, input.verdict.badge, 'MB', 10, 'right');
  const vBottom = Math.min(y, vTop - verdictLeft.length * 15 - 6);
  line(MARGIN_L, vBottom, MARGIN_L + CONTENT_W, vBottom, 0.8);
  cur().y = vBottom - 12;

  // ── Sections ────────────────────────────────────────────────
  for (const sec of input.sections) {
    ensure(40);
    sectionHeading(sec.heading, sec.right);
    if (sec.kind === 'kv' && sec.pairs) drawKv(sec.pairs);
    else if (sec.kind === 'table' && sec.columns && sec.rows) {
      const w = sec.widths && sec.widths.length === sec.columns.length ? sec.widths : sec.columns.map(() => 1 / sec.columns!.length);
      drawTable(sec.columns, sec.rows, w);
    } else if (sec.kind === 'para' && sec.paragraphs) {
      for (const p of sec.paragraphs) cur().y = block(MARGIN_L, p, 'H', 9, CONTENT_W, 13) - 4;
    }
  }

  // ── Footer ──────────────────────────────────────────────────
  ensure(30);
  const fy = cur().y - 6;
  line(MARGIN_L, fy + 6, MARGIN_L + CONTENT_W, fy + 6, 0.8);
  text(MARGIN_L, fy, 'CHUNGUZA COMPLIANCE ARCHIVE · IMMUTABLE REGULATORY RECORD', 'M', 7);
  text(MARGIN_L + CONTENT_W, fy, 'FATF REC. 16 · DO NOT ALTER', 'M', 7, 'right');
  text(MARGIN_L, fy - 11, `SHA-256: ${input.seal}`, 'M', 6.5);

  // ── Assemble PDF objects ────────────────────────────────────
  const n = pages.length;
  const objs: string[] = [];
  objs[1] = '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj';
  const kids: string[] = [];
  const PAGE_OBJ_START = 7;
  for (let i = 0; i < n; i += 1) kids.push(`${PAGE_OBJ_START + i * 2} 0 R`);
  objs[2] = `2 0 obj << /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >> endobj`;
  objs[3] = '3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj';
  objs[4] = '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj';
  objs[5] = '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Courier >> endobj';
  objs[6] = '6 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >> endobj';

  for (let i = 0; i < n; i += 1) {
    const content = pages[i].ops.join('\n');
    const pageObj = PAGE_OBJ_START + i * 2;
    const contentObj = pageObj + 1;
    objs[pageObj] = `${pageObj} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentObj} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> >> endobj`;
    objs[contentObj] = `${contentObj} 0 obj << /Length ${Buffer.byteLength(content)} >> stream\n${content}\nendstream endobj`;
  }

  const maxObj = PAGE_OBJ_START + n * 2 - 1;
  const header = '%PDF-1.4';
  // bodyParts are joined with '\n', so the first object begins one byte after
  // the header; every later object is offset by the same separator.
  let offset = Buffer.byteLength(header) + 1;
  const xref: string[] = [`0 ${maxObj + 1}`, '0000000000 65535 f '];
  const bodyParts: string[] = [header];
  for (let i = 1; i <= maxObj; i += 1) {
    const body = objs[i] || '';
    xref.push(`${String(offset).padStart(10, '0')} 00000 n `);
    bodyParts.push(body);
    offset += Buffer.byteLength(body) + 1;
  }
  const xrefStart = offset;
  const xrefBlock = `xref\n${xref.join('\n')}\n`;
  const trailer = `trailer << /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from([...bodyParts, xrefBlock, trailer].join('\n'), 'utf8');
}
