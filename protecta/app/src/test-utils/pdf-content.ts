import { inflateSync } from 'node:zlib';

/** PDF magic bytes check. */
export const isPdf = (bytes: Uint8Array): boolean =>
  Buffer.from(bytes).subarray(0, 5).toString('latin1') === '%PDF-';

/**
 * True when the ASCII `text` was drawn inside the PDF. Content streams are
 * FlateDecode-compressed and pdf-lib writes drawText as hex strings, so we
 * inflate each stream and look for the hex (or literal) form.
 */
export const pdfContains = (bytes: Uint8Array, text: string): boolean => {
  const buf = Buffer.from(bytes);
  const raw = buf.toString('latin1');
  const hexNeedle = Buffer.from(text, 'latin1').toString('hex').toUpperCase();
  const re = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) continue;
    try {
      const out = inflateSync(buf.subarray(start, end)).toString('latin1');
      if (out.includes(hexNeedle) || out.includes(text)) return true;
    } catch {
      // Not an inflatable stream — object streams, metadata, etc.
    }
  }
  return false;
};

/** Emoji and '&' are banned from outbound WhatsApp text (incl. captions). */
export const expectWhatsAppSafe = (text: string): void => {
  if (text.includes('&')) throw new Error(`caption contains '&': ${text}`);
  if (/\p{Extended_Pictographic}/u.test(text))
    throw new Error(`caption contains emoji: ${text}`);
};
