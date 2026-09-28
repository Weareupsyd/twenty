const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
};

/**
 * Best-effort HTML to plain text, used to derive the PDF and Word
 * outputs from HTML-format templates (the HTML page itself is served
 * verbatim as the primary HTML output).
 */
export const htmlToText = (html: string): string => {
  const withoutBlocks = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|br)\s*>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n');
  const withoutTags = withoutBlocks.replace(/<[^>]+>/g, '');
  const decoded = withoutTags.replace(
    /&(?:amp|lt|gt|quot|nbsp|mdash|ndash);|&#39;/g,
    (match) => ENTITIES[match] ?? match,
  );
  return decoded
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
};
