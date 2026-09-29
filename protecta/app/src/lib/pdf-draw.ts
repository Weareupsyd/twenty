import { type PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb } from 'pdf-lib';
import { PROTECTA_LOGO_PNG_BASE64 } from 'src/lib/brand-logo';

export const PAGE_W = 595.28; // A4
export const PAGE_H = 841.89;
export const MARGIN = 50;

// Documents are plain black on white: no colour, no filled boxes.
const BLACK = rgb(0, 0, 0);
export const NAVY = BLACK;
export const ORANGE = BLACK;
export const MUTED = BLACK;
export const HAIRLINE = BLACK;
export const INK = BLACK;

/** Embeds the Protecta Bode logo; returns undefined if it cannot be read. */
export const embedBrandLogo = async (
  doc: PDFDocument,
): Promise<PDFImage | undefined> => {
  try {
    return await doc.embedPng(Buffer.from(PROTECTA_LOGO_PNG_BASE64, 'base64'));
  } catch {
    return undefined;
  }
};

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
  logo?: PDFImage,
): Sheet => {
  const { font, bold } = fonts;
  const drawHeader = () => {
    const top = PAGE_H - MARGIN + 14;
    if (logo) {
      const h = 46;
      const w = (logo.width / logo.height) * h;
      page.drawImage(logo, { x: MARGIN, y: top - h, width: w, height: h });
    } else {
      page.drawText('Protecta Bode', { x: MARGIN, y: top - 20, size: 16, font: bold, color: BLACK });
    }
    const label = winAnsi(headerRight);
    const size = 11;
    page.drawText(label, {
      x: PAGE_W - MARGIN - bold.widthOfTextAtSize(label, size),
      y: top - 20,
      size,
      font: bold,
      color: BLACK,
    });
    page.drawLine({
      start: { x: MARGIN, y: top - 58 },
      end: { x: PAGE_W - MARGIN, y: top - 58 },
      thickness: 0.8,
      color: BLACK,
    });
  };
  drawHeader();

  const sheet: Sheet = {
    page,
    y: PAGE_H - MARGIN - 70,
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
        thickness: 0.3,
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
