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

export const textResponse = (text: string, status = 200): Response =>
  new Response(text, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

export const errorResponse = (error: unknown, fallbackStatus = 400): Response => {
  if (error instanceof Response) {
    return error;
  }
  const message = error instanceof Error ? error.message : 'Unexpected error.';
  const status =
    /not found/i.test(message) && fallbackStatus === 400 ? 404 : fallbackStatus;
  return jsonResponse({ ok: false, error: message }, status);
};

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

export const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

export const num = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Public origin for links customers open outside the app (WhatsApp, email).
 * Links in a WhatsApp message must be absolute, so an unset PUBLIC_BASE_URL
 * falls back to the production domain instead of emitting a relative path
 * nobody can tap.
 */
const DEFAULT_PUBLIC_BASE_URL = 'https://protectabode.weareupsyd.com';

export const publicBaseUrl = (): string =>
  (
    (process.env.PUBLIC_BASE_URL ?? '').trim() || DEFAULT_PUBLIC_BASE_URL
  ).replace(/\/$/, '');

export const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Server is missing configuration: ${name}.`);
  }
  return value;
};

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
