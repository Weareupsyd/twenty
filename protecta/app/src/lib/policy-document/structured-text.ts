// Copied from protecta/docgen/app/src/lib (keep in sync): lets the
// Protecta app turn a generated policy document into a PDF for delivery.
/**
 * Structured template text.
 *
 * Templates are plain text, but a policy schedule is not a wall of prose:
 * it has headings, numbered sections, lists and tables. These few markers
 * carry that structure through to every output (HTML page, PDF, Word)
 * without turning the template body into HTML or markup soup:
 *
 *   # Heading            a document heading
 *   ## Subheading        a section heading
 *   ### Sub-subheading   a clause heading
 *   - item               a bullet (also `* item`)
 *   | cell | cell |      consecutive lines form one table (first row = header)
 *   (blank line)         spacing between blocks
 *
 * Everything else is a paragraph. Old plain-text templates keep working:
 * with no markers, every line is just a paragraph.
 */

export type TableBlock = {
  type: 'table';
  rows: string[][];
};

export type StructuredBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string }
  | TableBlock
  | { type: 'spacer' };

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;

const isBlank = (line: string): boolean => line.trim().length === 0;

const parseTableRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

/**
 * Split a template body into blocks. Consecutive `| … |` lines become a
 * single table; consecutive blank lines collapse into one spacer.
 */
export const parseStructuredText = (content: string): StructuredBlock[] => {
  const blocks: StructuredBlock[] = [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let table: string[][] | null = null;

  const flushTable = () => {
    if (table && table.some((row) => row.some((cell) => cell.length > 0))) {
      blocks.push({ type: 'table', rows: table });
    }
    table = null;
  };

  for (const line of lines) {
    if (TABLE_ROW.test(line)) {
      const row = parseTableRow(line);
      table = table ? [...table, row] : [row];
      continue;
    }
    flushTable();

    if (isBlank(line)) {
      if (blocks.length > 0 && blocks[blocks.length - 1].type !== 'spacer') {
        blocks.push({ type: 'spacer' });
      }
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet) {
      blocks.push({ type: 'bullet', text: bullet[1].trim() });
      continue;
    }

    blocks.push({ type: 'paragraph', text: line.trim() });
  }
  flushTable();

  // A trailing spacer would only add an empty page.
  while (blocks.length > 0 && blocks[blocks.length - 1].type === 'spacer') {
    blocks.pop();
  }
  return blocks;
};

/** Plain text of a parsed body: used where layout cannot be honoured. */
export const blocksToText = (blocks: StructuredBlock[]): string =>
  blocks
    .map((block) => {
      if (block.type === 'table') {
        return block.rows.map((row) => row.join('  ')).join('\n');
      }
      return block.type === 'spacer' ? '' : block.text;
    })
    .join('\n');

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ] ?? char,
  );

/**
 * Render parsed blocks as HTML: the styled reading view in the CRM (and
 * print/PDF via the browser).
 */
export const structuredTextToHtml = (blocks: StructuredBlock[]): string => {
  const parts: string[] = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      parts.push('</ul>');
      listOpen = false;
    }
  };

  for (const block of blocks) {
    if (block.type !== 'bullet') closeList();

    switch (block.type) {
      case 'heading':
        parts.push(
          `<h${block.level + 1}>${escapeHtml(block.text)}</h${block.level + 1}>`,
        );
        break;
      case 'paragraph':
        parts.push(`<p>${escapeHtml(block.text)}</p>`);
        break;
      case 'bullet':
        if (!listOpen) {
          parts.push('<ul>');
          listOpen = true;
        }
        parts.push(`<li>${escapeHtml(block.text)}</li>`);
        break;
      case 'table': {
        const [header, ...body] = block.rows;
        const head = header
          ? `<thead><tr>${header
              .map((cell) => `<th>${escapeHtml(cell)}</th>`)
              .join('')}</tr></thead>`
          : '';
        const rows = body
          .map(
            (row) =>
              `<tr>${row
                .map((cell) => `<td>${escapeHtml(cell)}</td>`)
                .join('')}</tr>`,
          )
          .join('');
        parts.push(`<table>${head}<tbody>${rows}</tbody></table>`);
        break;
      }
      case 'spacer':
        break;
    }
  }
  closeList();
  return parts.join('\n');
};
