import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

/** Render template text into an editable Word document. */
export const renderDocx = async (content: string): Promise<Uint8Array> => {
  const lines = content.split('\n');
  const title = lines[0] ?? 'Document';
  const body = lines.slice(1);
  const doc = new Document({
    creator: 'Protecta Document Generator',
    title,
    sections: [
      {
        children: [
          new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
          ...body.map(
            (line) =>
              new Paragraph({
                children: [new TextRun(line)],
                spacing: { after: 80 },
              }),
          ),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
};
