import { describe, expect, it } from 'vitest';
import {
  BRAND_HEADER,
  claimUpdateMessage,
  opsAlertMessage,
  otpMessage,
  paymentConfirmedMessage,
  policyIssuedMessage,
  quoteIssuedMessage,
  renewalQuoteMessage,
  renewalReminderMessage,
} from 'src/lib/whatsapp-text';

const customerMessages = [
  quoteIssuedMessage({
    name: 'James Kintu',
    quoteRef: '482913',
    premium: 525_000,
    validUntil: '2026-10-14',
    shareUrl: 'https://protectabode.weareupsyd.com/s/protecta/quotes/view?ref=482913',
  }),
  paymentConfirmedMessage({
    quoteRef: '482913',
    amount: 525_000,
    policyNo: 'PB-2026-645558',
  }),
  policyIssuedMessage({
    policyNo: 'PB-2026-645558',
    plate: 'UBC100H',
    periodEnd: '2027-09-29',
    certUrl: 'https://protectabode.weareupsyd.com/s/protecta/policies/doc?ref=PB-2026-645558',
  }),
  claimUpdateMessage({ claimRef: 'CLM-12345678', status: 'IN_REVIEW' }),
  renewalReminderMessage({
    policyNo: 'PB-2026-645558',
    plate: 'UBC100H',
    periodEnd: '2027-09-29',
    quoteRef: '482913',
    premium: 525_000,
  }),
  renewalQuoteMessage({
    policyNo: 'PB-2026-645558',
    quoteRef: '482913',
    premium: 525_000,
    shareUrl: 'https://protectabode.weareupsyd.com/s/protecta/quotes/view?ref=482913',
  }),
  otpMessage('482913', 'payment'),
  opsAlertMessage('payment backlog', ['3 pending']),
];

describe('WhatsApp message text', () => {
  it('sends no emoji, so nothing renders as a stray glyph on any phone', () => {
    for (const message of customerMessages) {
      expect(message).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('never emits a raw ampersand that tools turn into &amp;', () => {
    for (const message of customerMessages) {
      expect(message).not.toContain('&');
      expect(message).not.toContain('&amp;');
    }
  });

  it('keeps the brand header and short references', () => {
    expect(quoteIssuedMessage({
      name: 'James Kintu',
      quoteRef: '482913',
      premium: 525_000,
      validUntil: '2026-10-14',
      shareUrl: 'https://protectabode.weareupsyd.com/s/protecta/quotes/view?ref=482913',
    })).toContain('• Quote: 482913');
    expect(BRAND_HEADER).toBe('*Protecta Bode*');
  });
});
