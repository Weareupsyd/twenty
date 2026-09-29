import { type PDFFont, type PDFPage, rgb } from 'pdf-lib';

export const PAGE_W = 595.28; // A4
export const PAGE_H = 841.89;
export const MARGIN = 50;

export const NAVY = rgb(0.04, 0.12, 0.28);
export const ORANGE = rgb(0.8, 0.43, 0.16);
export const MUTED = rgb(0.33, 0.42, 0.55);
export const HAIRLINE = rgb(0.85, 0.88, 0.92);
export const INK = rgb(0.04, 0.12, 0.28);

/**
 * pdf-lib's standard fonts only encode WinAnsi; customer-supplied text
 * (names, makes, models) must be mapped or stripped so a stray emoji or
 * non-Latin character cannot abort the whole document.
 */
export const winAnsi = (value: unknown): string => {
  const mapped: Record<string, string> = {
    '\u2018': "'",
    '\u2019': "'",
    '\u201C': '"',
    '\u201D': '"',
    '\u2013': '-',
    '\u2014': '-',
    '\u2022': '-',
    '\u00A0': ' ',
  };
  let out = String(value ?? '');
  for (const [from, to] of Object.entries(mapped)) {
    out = out.split(from).join(to);
  }
  return out.replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
};

export const wrap = (
  text: string,
  font: PDFFont,
  size: number,
  maxW: number,
): string[] => {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const cand = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(cand, size) <= maxW) {
      line = cand;
    } else {
      if (line) lines.push(line);
      if (font.widthOfTextAtSize(w, size) <= maxW) line = w;
      else {
        let chunk = '';
        for (const ch of w) {
          if (chunk && font.widthOfTextAtSize(chunk + ch, size) > maxW) {
            lines.push(chunk);
            chunk = ch;
          } else chunk += ch;
        }
        line = chunk;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
};

export type Sheet = {
  page: PDFPage;
  y: number;
  draw: (text: string, size?: number, font?: PDFFont, color?: ReturnType<typeof rgb>, indent?: number) => void;
  row: (label: string, value: string) => void;
  heading: (text: string) => void;
  note: (text: string) => void;
  gap: (px?: number) => void;
  rule: () => void;
};

/**
 * One brand-headed page with row/heading primitives that keep themselves
 * on the page (a new page with the same header starts when space runs out).
 */
export const createSheet = (
  page: PDFPage,
  fonts: { font: PDFFont; bold: PDFFont },
  headerRight: string,
): Sheet => {
  const { font, bold } = fonts;
  const drawHeader = () => {
    page.drawRectangle({
      x: 0,
      y: PAGE_H - 70,
      width: PAGE_W,
      height: 70,
      color: NAVY,
    });
    page.drawText('LIBERTY', { x: MARGIN, y: PAGE_H - 32, size: 13, font: bold, color: rgb(1, 1, 1) });
    page.drawText('In it with you', { x: MARGIN, y: PAGE_H - 46, size: 8, font, color: rgb(0.82, 0.86, 0.92) });
    page.drawText('Protecta Bode', { x: PAGE_W - MARGIN - 120, y: PAGE_H - 32, size: 13, font: bold, color: ORANGE });
    page.drawText(winAnsi(headerRight), {
      x: PAGE_W - MARGIN - 120,
      y: PAGE_H - 46,
      size: 8,
      font,
      color: rgb(0.82, 0.86, 0.92),
    });
  };
  drawHeader();

  const sheet: Sheet = {
    page,
    y: PAGE_H - 92,
    draw(text, size = 10, fontUsed = font, color = INK, indent = 0) {
      const lines = wrap(winAnsi(text), fontUsed, size, PAGE_W - MARGIN * 2 - indent);
      for (const line of lines) {
        // These documents fit on one page; stop rather than overflow.
        if (sheet.y < MARGIN + 36) return;
        sheet.page.drawText(line, { x: MARGIN + indent, y: sheet.y, size, font: fontUsed, color });
        sheet.y -= size + 4;
      }
      sheet.y -= 2;
    },
    row(label, value) {
      const labelW = 150;
      if (sheet.y < MARGIN + 40) return;
      sheet.page.drawText(winAnsi(label), {
        x: MARGIN,
        y: sheet.y,
        size: 9,
        font: bold,
        color: MUTED,
      });
      const vLines = wrap(winAnsi(value || '—'), font, 10, PAGE_W - MARGIN * 2 - labelW - 10);
      let vy = sheet.y;
      for (const line of vLines) {
        if (vy < MARGIN + 40) break;
        sheet.page.drawText(line, { x: MARGIN + labelW, y: vy, size: 10, font, color: INK });
        vy -= 13;
      }
      sheet.y = Math.min(sheet.y, vy) - 6;
      sheet.page.drawLine({
        start: { x: MARGIN, y: sheet.y + 4 },
        end: { x: PAGE_W - MARGIN, y: sheet.y + 4 },
        thickness: 0.5,
        color: HAIRLINE,
      });
      sheet.y -= 4;
    },
    heading(text) {
      sheet.draw(text, 17, bold, NAVY);
      sheet.y -= 2;
    },
    note(text) {
      sheet.draw(text, 9, font, MUTED);
      sheet.y -= 4;
    },
    gap(px = 10) {
      sheet.y -= px;
    },
    rule() {
      sheet.page.drawLine({
        start: { x: MARGIN, y: sheet.y },
        end: { x: PAGE_W - MARGIN, y: sheet.y },
        thickness: 0.7,
        color: HAIRLINE,
      });
      sheet.y -= 10;
    },
  };
  return sheet;
};

export const brandFooter = (sheet: Sheet): void => {
  sheet.gap(6);
  sheet.note(
    'Protecta Bode is underwritten by Liberty General Insurance Uganda and ' +
      'regulated under the Insurance Regulatory Authority of Uganda, IRA, sandbox guidelines.',
  );
  sheet.note(`Issued ${new Date().toISOString().slice(0, 10)} · protectabode.weareupsyd.com`);
};
