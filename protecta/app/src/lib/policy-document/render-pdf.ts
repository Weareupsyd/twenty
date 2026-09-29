// Copied from protecta/docgen/app/src/lib (keep in sync): lets the
// Protecta app turn a generated policy document into a PDF for delivery.
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import {
  parseStructuredText,
  type StructuredBlock,
  type TableBlock,
} from 'src/lib/policy-document/structured-text';

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const BOTTOM = MARGIN + 24;

const BODY_SIZE = 9.5;
const LINE_GAP = 13;
const HEADING_SIZES = { 1: 15, 2: 12, 3: 10.5 } as const;
const CELL_PADDING = 4;

export type RenderPdfOptions = {
  footerLeft?: string;
  title?: string;
};

const wrap = (
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) {
      lines.push(line);
      line = '';
    }
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    // A single word wider than the column: hard-split it.
    let chunk = '';
    for (const char of word) {
      if (chunk && font.widthOfTextAtSize(chunk + char, size) > maxWidth) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
};

type Cursor = {
  doc: PDFDocument;
  page: PDFPage;
  pageNo: number;
  y: number;
  font: PDFFont;
  bold: PDFFont;
  footerLeft: string;
};

const footer = (cursor: Cursor) => {
  const text = `${cursor.footerLeft}  ·  page ${cursor.pageNo}`;
  cursor.page.drawText(text, {
    x: MARGIN,
    y: MARGIN / 2,
    size: 7.5,
    font: cursor.font,
    color: rgb(0.45, 0.45, 0.5),
  });
};

const newPage = (cursor: Cursor) => {
  footer(cursor);
  cursor.page = cursor.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  cursor.pageNo += 1;
  cursor.y = PAGE_HEIGHT - MARGIN;
};

const ensureSpace = (cursor: Cursor, needed: number) => {
  if (cursor.y - needed < BOTTOM) newPage(cursor);
};

const drawHeading = (cursor: Cursor, level: 1 | 2 | 3, text: string) => {
  const size = HEADING_SIZES[level];
  // Keep a heading with what follows it instead of leaving it orphaned at
  // the bottom of a page (schedules and clause headings).
  ensureSpace(cursor, size + LINE_GAP * 3 + 12);
  cursor.y -= level === 1 ? 6 : 4;
  const lines = wrap(text, cursor.bold, size, PAGE_WIDTH - MARGIN * 2);
  for (const line of lines) {
    ensureSpace(cursor, size + 6);
    cursor.page.drawText(line, {
      x: MARGIN,
      y: cursor.y,
      size,
      font: cursor.bold,
      color: rgb(0.04, 0.12, 0.28),
    });
    cursor.y -= size + 4;
  }
  cursor.y -= 3;
};

const drawParagraph = (cursor: Cursor, text: string) => {
  const lines = wrap(text, cursor.font, BODY_SIZE, PAGE_WIDTH - MARGIN * 2);
  for (const line of lines) {
    ensureSpace(cursor, LINE_GAP);
    cursor.page.drawText(line, {
      x: MARGIN,
      y: cursor.y,
      size: BODY_SIZE,
      font: cursor.font,
      color: rgb(0.05, 0.05, 0.08),
    });
    cursor.y -= LINE_GAP;
  }
  cursor.y -= 2;
};

const drawBullet = (cursor: Cursor, text: string) => {
  const indent = 14;
  const width = PAGE_WIDTH - MARGIN * 2 - indent;
  const lines = wrap(text, cursor.font, BODY_SIZE, width);
  lines.forEach((line, index) => {
    ensureSpace(cursor, LINE_GAP);
    if (index === 0) {
      cursor.page.drawText('•', {
        x: MARGIN + 2,
        y: cursor.y,
        size: BODY_SIZE,
        font: cursor.bold,
        color: rgb(0.05, 0.05, 0.08),
      });
    }
    cursor.page.drawText(line, {
      x: MARGIN + indent,
      y: cursor.y,
      size: BODY_SIZE,
      font: cursor.font,
      color: rgb(0.05, 0.05, 0.08),
    });
    cursor.y -= LINE_GAP;
  });
  cursor.y -= 2;
};

/** Column widths proportional to content, clamped so no column vanishes. */
const columnWidths = (
  rows: string[][],
  columns: number,
  available: number,
): number[] => {
  const weights = Array.from({ length: columns }, (_, index) => {
    const longest = Math.max(
      1,
      ...rows.map((row) => (row[index] ?? '').length),
    );
    return Math.min(longest, 48);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = weights.map((weight) => (weight / total) * available);
  const minimum = 46;
  return widths.map((width) => Math.max(minimum, width));
};

const normaliseRows = (block: TableBlock, columns: number): string[][] =>
  block.rows.map((row) => {
    const cells = [...row];
    while (cells.length < columns) cells.push('');
    return cells.slice(0, columns);
  });

const drawTable = (cursor: Cursor, block: TableBlock) => {
  const columns = Math.max(...block.rows.map((row) => row.length));
  const available = PAGE_WIDTH - MARGIN * 2;
  const rawWidths = columnWidths(block.rows, columns, available);
  const scale = available / rawWidths.reduce((sum, width) => sum + width, 0);
  const widths = rawWidths.map((width) => width * scale);
  const rows = normaliseRows(block, columns);

  const layout = (row: string[]): { lines: string[][]; height: number } => {
    const lines = row.map((cell, index) =>
      wrap(
        cell,
        cursor.font,
        BODY_SIZE,
        widths[index] - CELL_PADDING * 2,
      ),
    );
    const height = Math.max(...lines.map((cell) => cell.length)) * LINE_GAP +
      CELL_PADDING * 2;
    return { lines, height };
  };

  const drawRow = (
    row: string[],
    isHeader: boolean,
    keepWith?: number,
  ) => {
    const { lines, height } = layout(row);
    if (cursor.y - height - (keepWith ?? 0) < BOTTOM) {
      newPage(cursor);
      return false;
    }
    const top = cursor.y;
    if (isHeader) {
      cursor.page.drawRectangle({
        x: MARGIN,
        y: top - height,
        width: available,
        height,
        color: rgb(0.92, 0.94, 0.97),
      });
    }
    let x = MARGIN;
    row.forEach((_, index) => {
      lines[index].forEach((line, lineIndex) => {
        if (!line) return;
        cursor.page.drawText(line, {
          x: x + CELL_PADDING,
          y: top - CELL_PADDING - LINE_GAP * (lineIndex + 1) + 2,
          size: BODY_SIZE,
          font: isHeader ? cursor.bold : cursor.font,
          color: rgb(0.05, 0.05, 0.08),
        });
      });
      x += widths[index];
    });

    // Row and column rules.
    cursor.page.drawLine({
      start: { x: MARGIN, y: top - height },
      end: { x: MARGIN + available, y: top - height },
      thickness: 0.5,
      color: rgb(0.75, 0.78, 0.82),
    });
    x = MARGIN;
    for (const width of widths) {
      cursor.page.drawLine({
        start: { x, y: top },
        end: { x, y: top - height },
        thickness: 0.5,
        color: rgb(0.75, 0.78, 0.82),
      });
      x += width;
    }
    cursor.page.drawLine({
      start: { x: MARGIN + available, y: top },
      end: { x: MARGIN + available, y: top - height },
      thickness: 0.5,
      color: rgb(0.75, 0.78, 0.82),
    });
    cursor.y = top - height;
    return true;
  };

  const [header, ...body] = rows;
  cursor.y -= 2;
  if (header && !drawRow(header, true, LINE_GAP * 3)) {
    // The header moved to a fresh page; draw it there.
    drawRow(header, true, LINE_GAP * 3);
  }
  for (const row of body) {
    drawRow(row, false);
  }
  cursor.y -= 6;
};

const drawBlock = (cursor: Cursor, block: StructuredBlock) => {
  switch (block.type) {
    case 'heading':
      drawHeading(cursor, block.level, block.text);
      break;
    case 'paragraph':
      drawParagraph(cursor, block.text);
      break;
    case 'bullet':
      drawBullet(cursor, block.text);
      break;
    case 'table':
      drawTable(cursor, block);
      break;
    case 'spacer':
      cursor.y -= LINE_GAP;
      break;
  }
};

/**
 * Render a template body into an A4 PDF. The first heading (or the first
 * line, for plain-text bodies) is drawn as the cover title.
 */
export const renderPdf = async (
  content: string,
  options: RenderPdfOptions = {},
): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const blocks = parseStructuredText(content);
  const title =
    options.title ??
    (blocks[0]?.type === 'heading'
      ? blocks[0].text
      : blocks[0]?.type === 'paragraph'
        ? blocks[0].text
        : 'Document');
  const body = blocks[0]?.type === 'table' ? blocks : blocks.slice(1);

  const cursor: Cursor = {
    doc,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    pageNo: 1,
    y: PAGE_HEIGHT - MARGIN,
    font,
    bold,
    footerLeft: options.footerLeft ?? 'Protecta Document Generator',
  };

  for (const line of wrap(title, bold, 17, PAGE_WIDTH - MARGIN * 2)) {
    cursor.page.drawText(line, {
      x: MARGIN,
      y: cursor.y,
      size: 17,
      font: bold,
      color: rgb(0.04, 0.12, 0.28),
    });
    cursor.y -= 22;
  }
  cursor.y -= 10;

  for (const block of body) {
    drawBlock(cursor, block);
  }
  footer(cursor);

  return doc.save();
};
