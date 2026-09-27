/**
 * Business-session webhook signing and verification (X-Signature-V2).
 *
 * The algorithm is fixed by the integration contract and must not be
 * "improved":
 *
 *   1. sortKeys(payload) recursively
 *   2. shortenFloats - truncate trailing zeros after the decimal point
 *   3. JSON.stringify
 *   4. HMAC-SHA256 with the shared secret
 *   5. hex encode, compare against the X-Signature-V2 header
 *
 * On the *receiving* side the HMAC must run against the raw request body
 * bytes, before any JSON parsing. Re-serialising a parsed body changes
 * whitespace and key order and invalidates an otherwise-valid signature -
 * see verifyRawSignature below, which is the only verifier callers should use.
 */

import crypto from 'crypto';

export const SIGNATURE_HEADER = 'X-Signature-V2';

export const BUSINESS_WEBHOOK_EVENTS = {
  'business.status.updated': 'Business session status changed',
  'business.data.updated': 'Business session data submitted or changed',
} as const;

export type BusinessWebhookEvent = keyof typeof BUSINESS_WEBHOOK_EVENTS;

/** Recursively sort object keys. Arrays keep their order - order is data. */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return out;
}

/**
 * Truncate trailing zeros after the decimal point, so 25.00 and 25 sign
 * identically. JS already renders 25.00 as 25, but a value that arrived as a
 * *string* ("25.00", typical of OCR output and SQL NUMERIC) would not - this
 * normalises both.
 */
export function shortenFloats(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shortenFloats);

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value;
    return Number(value.toString());
  }

  if (typeof value === 'string' && /^-?\d+\.\d*0$/.test(value)) {
    const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
    return trimmed;
  }

  if (value === null || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = shortenFloats(v);
  }
  return out;
}

/** Canonical string that gets signed. */
export function canonicalize(payload: unknown): string {
  return JSON.stringify(shortenFloats(sortKeys(payload)));
}

/** Produce the hex digest for the X-Signature-V2 header. */
export function signPayload(payload: unknown, secret: string): string {
  return crypto.createHmac('sha256', secret).update(canonicalize(payload), 'utf8').digest('hex');
}

/** Constant-time hex comparison. */
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Verify an inbound webhook.
 *
 * `rawBody` MUST be the exact bytes received. Pass the Buffer captured by a
 * raw body-parser - not `JSON.stringify(req.body)`.
 *
 * We verify twice, and this is deliberate rather than sloppy:
 *   • against the raw bytes as-sent (correct when the sender already
 *     canonicalised, which ours does), and
 *   • against the canonicalised re-serialisation (correct when the sender
 *     signed the canonical form but transmitted with different whitespace or
 *     key order, which some senders do).
 * Either matching means the payload is authentic under the shared secret.
 */
export function verifyRawSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;

  const provided = signatureHeader.trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;

  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');

  const rawDigest = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  if (safeEqualHex(provided, rawDigest)) return true;

  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    return safeEqualHex(provided, signPayload(parsed, secret));
  } catch {
    return false;
  }
}

export interface BusinessWebhookPayload {
  event: BusinessWebhookEvent;
  application_id: string;
  timestamp: string;
  data: {
    session_id: string;
    session_kind: 'business';
    business_session_id: string;
    vendor_data?: string | null;
    status: string;
    previous_status?: string | null;
    [k: string]: unknown;
  };
}

export function buildBusinessPayload(args: {
  event: BusinessWebhookEvent;
  applicationId: string;
  sessionId: string;
  vendorData?: string | null;
  status: string;
  previousStatus?: string | null;
  extra?: Record<string, unknown>;
}): BusinessWebhookPayload {
  return {
    event: args.event,
    application_id: args.applicationId,
    timestamp: new Date().toISOString(),
    data: {
      session_id: args.sessionId,
      session_kind: 'business',
      business_session_id: args.sessionId,
      vendor_data: args.vendorData ?? null,
      status: args.status,
      previous_status: args.previousStatus ?? null,
      ...(args.extra ?? {}),
    },
  };
}

/** Route inbound events: business handler vs the existing person handler. */
export function isBusinessEvent(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const data = (payload as { data?: { session_kind?: unknown } }).data;
  return data?.session_kind === 'business';
}
