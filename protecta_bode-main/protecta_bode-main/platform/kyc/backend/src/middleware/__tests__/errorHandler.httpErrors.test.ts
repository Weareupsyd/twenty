/**
 * Non-operational errors that carry a client-safe 4xx status must keep their
 * real status code instead of collapsing into the blanket 500.
 *
 * Incident context: csrf-csrf's ForbiddenError (403, expose=true, no
 * isOperational flag) was masked as 500 "Something went wrong!" in production,
 * which both paged on-call for routine CSRF rejections and told the frontend
 * nothing actionable (it listens for 403 + CSRF_INVALID to refetch a token).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/config/index.js', () => ({
  default: { jwtSecret: 'x', nodeEnv: 'test', apiKeySecret: 'x' },
}));

vi.mock('@/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logError: vi.fn(),
}));

interface Captured {
  status: number;
  body: any;
}

function capture(errorHandler: any, err: any): Captured {
  const out: Captured = { status: 0, body: null };
  const mockReq = { originalUrl: '/api/test', method: 'POST', ip: '127.0.0.1', headers: {} } as any;
  const mockRes = {
    status: (code: number) => ({
      json: (b: any) => {
        out.status = code;
        out.body = b;
        return b;
      },
    }),
    statusCode: 200,
  } as any;
  errorHandler(err, mockReq, mockRes, () => {});
  return out;
}

describe('errorHandler http-errors passthrough', () => {
  it('keeps 403 + message for an http-errors ForbiddenError (csrf-csrf shape)', async () => {
    const { errorHandler } = await import('../errorHandler.js');
    const createError = (await import('http-errors')).default;

    const err = createError(403, 'Invalid CSRF token', { code: 'CSRF_INVALID' });
    const out = capture(errorHandler, err);

    expect(out.status).toBe(403);
    expect(out.body.code).toBe('CSRF_INVALID');
    expect(out.body.message).toBe('Invalid CSRF token');
  });

  it('keeps 400 + exposed message for a body-parser-style error', async () => {
    const { errorHandler } = await import('../errorHandler.js');
    const createError = (await import('http-errors')).default;

    const err = createError(400, 'Unexpected token in JSON');
    const out = capture(errorHandler, err);

    expect(out.status).toBe(400);
    expect(out.body.message).toBe('Unexpected token in JSON');
  });

  it('still hides non-exposed 4xx-shaped errors behind the generic 500', async () => {
    const { errorHandler } = await import('../errorHandler.js');

    const out = capture(errorHandler, { statusCode: 403, message: 'internal detail', expose: false });

    expect(out.status).toBe(500);
    expect(out.body.message).toBe('Something went wrong!');
  });

  it('unknown errors without a status still return the generic 500', async () => {
    const { errorHandler } = await import('../errorHandler.js');

    const out = capture(errorHandler, new Error('boom'));

    expect(out.status).toBe(500);
    expect(out.body.message).toBe('Something went wrong!');
  });
});
