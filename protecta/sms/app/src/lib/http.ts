import { type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

export const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
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
