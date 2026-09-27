import { describe, it, expect } from 'vitest';
import {
  isRecoverablePgDisconnect,
  summarizePgError,
} from '../pgErrors.js';

describe('isRecoverablePgDisconnect', () => {
  it('treats FATAL 57P01 (admin shutdown) as recoverable', () => {
    const err = Object.assign(new Error('terminating connection due to administrator command'), {
      code: '57P01',
      severity: 'FATAL',
    });
    expect(isRecoverablePgDisconnect(err)).toBe(true);
  });

  it('treats ECONNRESET as recoverable', () => {
    const err = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    expect(isRecoverablePgDisconnect(err)).toBe(true);
  });

  it('does not treat application SQL errors as recoverable', () => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    });
    expect(isRecoverablePgDisconnect(err)).toBe(false);
  });

  it('does not treat a generic Error as recoverable', () => {
    expect(isRecoverablePgDisconnect(new Error('boom'))).toBe(false);
  });
});

describe('summarizePgError', () => {
  it('omits the attached pg Client object', () => {
    const err = Object.assign(new Error('terminating connection due to administrator command'), {
      code: '57P01',
      severity: 'FATAL',
      client: { connection: { stream: Buffer.alloc(1024) }, _ending: true },
    });
    const summary = summarizePgError(err);
    expect(summary).toEqual({
      code: '57P01',
      message: 'terminating connection due to administrator command',
      severity: 'FATAL',
    });
    expect(summary).not.toHaveProperty('client');
  });
});
