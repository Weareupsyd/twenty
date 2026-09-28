import { describe, expect, it } from 'vitest';
import { renderDocx } from 'src/lib/docx';
import { renderPdf } from 'src/lib/pdf';
import { parseStructuredText, structuredTextToHtml } from 'src/lib/structured-text';

const CONTENT = [
  '# Motor policy certificate',
  '',
  'Policy no: PB-2026-004213',
  '',
  '## Schedule',
  '| Field | Value |',
  '| Insured | Sarah Kato |',
  '| Plate | UAX 123C |',
  '',
  '- first bullet',
  '- second bullet',
].join('\n');

describe('parseStructuredText', () => {
  it('parses headings, tables, bullets and paragraphs', () => {
    const blocks = parseStructuredText(CONTENT);
    expect(blocks[0]).toEqual({ type: 'heading', level: 1, text: 'Motor policy certificate' });
    const table = blocks.find((b) => b.type === 'table');
    expect(table).toMatchObject({ rows: [['Field', 'Value'], ['Insured', 'Sarah Kato'], ['Plate', 'UAX 123C']] });
    expect(blocks.filter((b) => b.type === 'bullet')).toHaveLength(2);
  });

  it('treats marker-free text as paragraphs', () => {
    const blocks = parseStructuredText('one\n\ntwo');
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'one' },
      { type: 'spacer' },
      { type: 'paragraph', text: 'two' },
    ]);
  });
});

describe('structuredTextToHtml', () => {
  it('escapes and structures', () => {
    const html = structuredTextToHtml(parseStructuredText('# A & B\n\n- <x>'));
    expect(html).toContain('<h2>A &amp; B</h2>');
    expect(html).toContain('<li>&lt;x&gt;</li>');
  });
});

describe('renderPdf', () => {
  it('produces a PDF from structured content', async () => {
    const bytes = await renderPdf(CONTENT);
    expect(Buffer.from(bytes.slice(0, 4)).toString('latin1')).toBe('%PDF');
    expect(bytes.length).toBeGreaterThan(500);
  });
});

describe('renderDocx', () => {
  it('produces a Word document', async () => {
    const bytes = await renderDocx(CONTENT);
    expect(Buffer.from(bytes.slice(0, 2)).toString('latin1')).toBe('PK');
    expect(bytes.length).toBeGreaterThan(500);
  });
});
