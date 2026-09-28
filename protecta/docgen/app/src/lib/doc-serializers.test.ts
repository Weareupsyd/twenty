import { describe, expect, it } from 'vitest';
import { renderDocx } from 'src/lib/docx';
import { renderPdf } from 'src/lib/pdf';

const CONTENT = [
  'Protecta Bode',
  'Motor policy certificate',
  '',
  'Policy no: PB-2026-004213',
  'A long line that needs wrapping in the PDF renderer so the layout stays readable on A4 pages even for verbose certificate wording.',
].join('\n');

describe('renderPdf', () => {
  it('produces a PDF', async () => {
    const bytes = await renderPdf(CONTENT);
    expect(Buffer.from(bytes.slice(0, 4)).toString('latin1')).toBe('%PDF');
    expect(bytes.length).toBeGreaterThan(500);
  });
});

describe('renderDocx', () => {
  it('produces a Word document (zip container)', async () => {
    const bytes = await renderDocx(CONTENT);
    // A .docx file is a ZIP archive (PK magic).
    expect(Buffer.from(bytes.slice(0, 2)).toString('latin1')).toBe('PK');
    expect(bytes.length).toBeGreaterThan(500);
  });
});
