import { afterEach, describe, expect, it } from 'vitest';
import { amlPortEnabled } from '../flag.js';

describe('amlPortEnabled', () => {
  const prev = process.env.AML_TS_PORT;
  afterEach(() => {
    if (prev === undefined) delete process.env.AML_TS_PORT;
    else process.env.AML_TS_PORT = prev;
  });

  it('is off by default', () => {
    delete process.env.AML_TS_PORT;
    expect(amlPortEnabled()).toBe(false);
  });

  it('is on for true/1', () => {
    process.env.AML_TS_PORT = 'true';
    expect(amlPortEnabled()).toBe(true);
    process.env.AML_TS_PORT = '1';
    expect(amlPortEnabled()).toBe(true);
  });
});
