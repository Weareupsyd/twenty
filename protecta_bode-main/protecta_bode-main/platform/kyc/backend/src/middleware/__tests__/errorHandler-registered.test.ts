import { describe, it, expect } from 'vitest';
import { errorHandler } from '../errorHandler.js';

describe('errorHandler export', () => {
  it('is exported as a function', () => {
    expect(typeof errorHandler).toBe('function');
  });

  it('has arity 4 - correct Express error-handler signature', () => {
    // Express identifies error handlers by having exactly 4 parameters: (err, req, res, next)
    expect(errorHandler.length).toBe(4);
  });

  it('does not throw when invoked with an operational error', () => {
    const mockErr = { message: 'test error', statusCode: 400, status: 'fail', isOperational: true };
    const mockReq = { originalUrl: '/test', method: 'GET', ip: '127.0.0.1', headers: {} } as any;
    const mockRes = {
      status: (code: number) => ({ json: (body: any) => body }),
      statusCode: 200,
    } as any;
    const mockNext = () => {};
    expect(() => errorHandler(mockErr, mockReq, mockRes, mockNext)).not.toThrow();
  });

  it('maps a Postgres foreign-key violation (23503) to an operational 400', () => {
    const fkErr = {
      code: '23503',
      message:
        'insert or update on table "business_sessions" violates foreign key ' +
        'constraint "business_sessions_developer_id_fkey"',
    };
    const mockReq = { originalUrl: '/api/v2/business/session', method: 'POST', ip: '127.0.0.1', headers: {} } as any;

    let statusCode = 0;
    let body: any = null;
    const mockRes = {
      status: (code: number) => {
        statusCode = code;
        return { json: (b: any) => { body = b; return b; } };
      },
    } as any;

    errorHandler(fkErr, mockReq, mockRes, () => {});

    expect(statusCode).toBe(400);
    expect(body.code).toBe('FOREIGN_KEY_VIOLATION');
    expect(body.message).toContain('business_sessions_developer_id_fkey');
  });
});
