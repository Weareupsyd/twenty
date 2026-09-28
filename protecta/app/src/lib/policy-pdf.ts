import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { formatUgx } from 'src/lib/money';
import { type RecordData } from 'src/lib/records';

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 50;

const wrap = (text: string, font: any, size: number, maxW: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
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

export const generatePolicyPdf = async (policy: RecordData, quote?: RecordData | null, password?: string | null): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const draw = (text: string, size: number, f = font, color = rgb(0.05, 0.05, 0.08), indent = 0) => {
    const lines = wrap(text, f, size, PAGE_W - MARGIN * 2 - indent);
    for (const line of lines) {
      if (y < MARGIN + 30) return; // avoid overflow for simple cert
      page.drawText(line, { x: MARGIN + indent, y, size, font: f, color });
      y -= size + 4;
    }
    y -= 2;
  };

  const drawRow = (label: string, value: string) => {
    const labelW = 150;
    if (y < MARGIN + 30) return;
    page.drawText(label, { x: MARGIN, y, size: 9, font: bold, color: rgb(0.33, 0.42, 0.55) });
    const vLines = wrap(value || '—', font, 10, PAGE_W - MARGIN * 2 - labelW - 10);
    let vy = y;
    for (let i = 0; i < vLines.length; i++) {
      if (i > 0 && vy < MARGIN + 30) break;
      page.drawText(vLines[i], { x: MARGIN + labelW, y: vy, size: 10, font, color: rgb(0.04, 0.12, 0.28) });
      vy -= 13;
    }
    y = Math.min(y, vy) - 6;
    // thin line
    page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: PAGE_W - MARGIN, y: y + 4 }, thickness: 0.5, color: rgb(0.85, 0.88, 0.92) });
    y -= 4;
  };

  // Header
  page.drawRectangle({ x: 0, y: PAGE_H - 70, width: PAGE_W, height: 70, color: rgb(0.04, 0.12, 0.28) });
  page.drawText('LIBERTY', { x: MARGIN, y: PAGE_H - 32, size: 13, font: bold, color: rgb(1, 1, 1) });
  page.drawText('In it with you', { x: MARGIN, y: PAGE_H - 46, size: 8, font, color: rgb(0.82, 0.86, 0.92) });
  page.drawText('Protecta Bode', { x: PAGE_W - MARGIN - 120, y: PAGE_H - 32, size: 13, font: bold, color: rgb(0.8, 0.43, 0.16) });
  page.drawText('Motor Policy Certificate', { x: PAGE_W - MARGIN - 120, y: PAGE_H - 46, size: 8, font, color: rgb(0.82, 0.86, 0.92) });

  y = PAGE_H - 90;
  draw('Motor Policy Certificate', 18, bold, rgb(0.04, 0.12, 0.28));
  draw(`Policy ${String(policy.policyNo ?? '')}  •  ${String(policy.status ?? 'ACTIVE')}`, 10, font, rgb(0.33, 0.42, 0.55));
  y -= 6;

  // Summary box
  const premium = formatUgx(Number(policy.premiumUgx ?? policy.premium ?? 0));
  const sumInsured = policy.sumInsuredUgx ? formatUgx(Number(policy.sumInsuredUgx)) : (quote ? formatUgx(Number((quote as any).vehicleValue ?? 0)) : '—');
  page.drawRectangle({ x: MARGIN, y: y - 46, width: PAGE_W - MARGIN * 2, height: 46, color: rgb(0.04, 0.12, 0.28) });
  page.drawText('Annual premium', { x: MARGIN + 14, y: y + 2, size: 8, font, color: rgb(0.78, 0.82, 0.9) });
  page.drawText(premium, { x: MARGIN + 14, y: y - 18, size: 18, font: bold, color: rgb(1, 1, 1) });
  page.drawText('1.5% of value + levies', { x: MARGIN + 14, y: y - 32, size: 7, font, color: rgb(0.78, 0.82, 0.9) });
  const rate = '1.5%';
  page.drawText(rate, { x: PAGE_W - MARGIN - 46, y: y - 6, size: 12, font: bold, color: rgb(0.8, 0.43, 0.16) });
  y -= 62;

  drawRow('Policy no', String(policy.policyNo ?? ''));
  drawRow('Quote ref', String(policy.quoteRef ?? (quote ? String((quote as any).reference ?? '') : '')));
  drawRow('Number plate', String(policy.plate ?? (quote ? String((quote as any).plate ?? '') : '')));
  drawRow('Vehicle', `${String(policy.vehicleMake ?? '')} ${String(policy.vehicleModel ?? '')}`.trim() || (quote ? `${String((quote as any).vehicleMake ?? '')} ${String((quote as any).vehicleModel ?? '')}`.trim() : '—'));
  drawRow('Sum insured', sumInsured);
  drawRow('Period', `${String(policy.periodStart ?? '—')}  →  ${String(policy.periodEnd ?? '—')}`);
  drawRow('Premium paid', premium);
  if (policy.bodyType || (quote && (quote as any).bodyType)) drawRow('Body type', String(policy.bodyType ?? (quote ? String((quote as any).bodyType ?? '') : '')));
  if (policy.engineCc) drawRow('Engine (c.c.)', String(policy.engineCc));
  if (policy.seatingCapacity) drawRow('Seats', String(policy.seatingCapacity));

  y -= 10;
  draw('What is covered', 12, bold, rgb(0.04, 0.12, 0.28));
  draw('• Car body  • Third party  • Driver cover — in case of an accident, for 12 months.', 9);
  y -= 6;
  draw('Terms and Conditions apply. Keep this certificate as proof of cover. For claims, contact Liberty General Insurance Uganda or reply 5 to the Protecta Bode WhatsApp bot.', 8, font, rgb(0.33, 0.42, 0.55));

  // Footer
  page.drawText(`Protecta Bode is underwritten by Liberty General Insurance Uganda • regulated by the Insurance Regulatory Authority of Uganda (IRA) • ${new Date().getFullYear()}`, {
    x: MARGIN,
    y: MARGIN - 10,
    size: 6.5,
    font,
    color: rgb(0.45, 0.5, 0.58),
  });
  page.drawText(`Generated ${new Date().toISOString().slice(0, 10)} • ${String(policy.policyNo ?? '')}`, {
    x: MARGIN,
    y: MARGIN - 22,
    size: 6.5,
    font,
    color: rgb(0.45, 0.5, 0.58),
  });

  if (password) {
    const displayPw = String(password);
    const digits = displayPw.replace(/[^0-9]/g, '');
    // Visible watermark that PDF is password-protected
    page.drawText(`🔒 Password: ${displayPw} (your phone number) — required to open this PDF`, {
      x: MARGIN,
      y: MARGIN - 36,
      size: 7,
      font,
      color: rgb(0.6, 0.2, 0.2),
    });
    try {
      const js = `
var _pw = app.response({cQuestion: "This policy PDF is password protected.\\nEnter your phone number to open it:\\n(e.g. ${displayPw})", cTitle: "Protecta Bode — Password required", bPassword: true, cLabel: "Phone"});
if (_pw) {
  var _d = _pw.replace(/[^0-9]/g, "");
  var _e = "${digits}";
  var _last9 = function(s){ return s.slice(-9); };
  if (_last9(_d) !== _last9(_e)) {
    app.alert("Wrong password — please enter the phone number you used at purchase (e.g. ${displayPw}).", 1);
    this.closeDoc(true);
  }
} else {
  this.closeDoc(true);
}
`;
      // pdf-lib JS embedding (if available)
      if (typeof (doc as any).addJavaScript === 'function') {
        (doc as any).addJavaScript('protecta_password', js);
      }
    } catch (e) {
      console.error('pdf js password failed', e);
    }
  }

  return doc.save();
};
