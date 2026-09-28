import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { parseStructuredText, type StructuredBlock } from 'src/lib/structured-text';

const HEADINGS = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
} as const;

export type RenderDocxOptions = {
  title?: string;
  footerText?: string;
};

const cell = (text: string, bold: boolean): TableCell =>
  new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold, size: 18 })],
      }),
    ],
  });

/** Render a template body into an editable Word document. */
export const renderDocx = async (
  content: string,
  options: RenderDocxOptions = {},
): Promise<Uint8Array> => {
  const blocks = parseStructuredText(content);
  const title =
    options.title ??
    (blocks[0]?.type === 'heading'
      ? blocks[0].text
      : blocks[0]?.type === 'paragraph'
        ? blocks[0].text
        : 'Document');

  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
  ];

  for (const block of blocks.slice(1) as StructuredBlock[]) {
    switch (block.type) {
      case 'heading':
        children.push(
          new Paragraph({ text: block.text, heading: HEADINGS[block.level] }),
        );
        break;
      case 'paragraph':
        children.push(
          new Paragraph({
            children: [new TextRun({ text: block.text })],
            spacing: { after: 120 },
          }),
        );
        break;
      case 'bullet':
        children.push(
          new Paragraph({
            children: [new TextRun({ text: block.text })],
            bullet: { level: 0 },
            spacing: { after: 60 },
          }),
        );
        break;
      case 'table': {
        const [header, ...body] = block.rows;
        const rows: TableRow[] = [];
        if (header) {
          rows.push(
            new TableRow({
              tableHeader: true,
              children: header.map((text) => cell(text, true)),
            }),
          );
        }
        for (const row of body) {
          rows.push(
            new TableRow({
              children: row.map((text) => cell(text, false)),
            }),
          );
        }
        children.push(
          new Table({
            rows,
            width: { size: 100, type: WidthType.PERCENTAGE },
          }),
        );
        children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
        break;
      }
      case 'spacer':
        children.push(new Paragraph({ text: '' }));
        break;
    }
  }

  const doc = new Document({
    creator: 'Protecta Document Generator',
    title,
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 20 },
          paragraph: { spacing: { after: 80 } },
        },
      },
    },
    sections: [
      {
        properties: {},
        children,
        // The certificate is a formal document: keep the footer textual
        // rather than adding page fields the runtime cannot evaluate.
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: options.footerText ?? 'Protecta Document Generator',
                    size: 14,
                    color: '888888',
                  }),
                ],
              }),
            ],
          }),
        },
      },
    ],
  });
  return Packer.toBuffer(doc);
};
