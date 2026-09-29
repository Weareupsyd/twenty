import { describe, expect, it } from 'vitest';
import {
  makeClaimRef,
  makePaymentRef,
  makePolicyNo,
  makeQuoteRef,
  makeTicketRef,
} from 'src/lib/refs';

describe('references', () => {
  it('builds short 6-digit quote refs', () => {
    expect(makeQuoteRef(() => 0.123456789)).toMatch(/^\d{6}$/);
  });

  it('builds prefixed refs', () => {
    expect(makePolicyNo(() => 0.5)).toMatch(/^PB-\d{4}-\d{6}$/);
    expect(makeClaimRef(() => 0.5)).toMatch(/^CLM-\d{8}$/);
    expect(makeTicketRef(() => 0.5)).toMatch(/^TCK-\d{6}$/);
    expect(makePaymentRef(() => 0.5)).toMatch(/^PAY-\d{6}$/);
  });
});
