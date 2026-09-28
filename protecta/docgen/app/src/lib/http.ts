import { type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

export const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const htmlResponse = (html: string, status = 200): Response =>
  new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });

export const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

export const parseJsonBody = (event: RoutePayload): Record<string, unknown> => {
  const body = event.body as Record<string, unknown> | string | null;
  if (!body) {
    return {};
  }
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return body;
};

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ] ?? char,
  );

export const renderDocPage = (args: {
  title: string;
  heading: string;
  bodyHtml: string;
}): string =>
  `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(args.title)}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f4f5f8;color:#111827}
header{background:#0b1f3f;color:#fff;padding:16px 24px}
header h1{margin:0;font-size:18px}
main{max-width:960px;margin:24px auto;padding:0 16px}
.note{color:#4b5563;font-size:14px}
</style></head>
<body><header><h1>${escapeHtml(args.heading)}</h1></header>
<main>${args.bodyHtml}</main></body></html>`;
