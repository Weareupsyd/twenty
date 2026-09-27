import { describe, expect, it } from 'vitest';
import { approvedWebhookUrl } from 'src/logic-functions/webhook-dispatch.logic-function';
describe('partner webhook egress', () => {
  it('requires an explicit HTTPS origin and refuses embedded credentials', () => {
    expect(
      approvedWebhookUrl(
        'https://partner.example/events',
        'https://partner.example',
      ).pathname,
    ).toBe('/events');
    for (const url of [
      'http://partner.example/events',
      'https://evil.example/events',
      'https://partner.example.evil.test/events',
      'https://user:pass@partner.example/events',
      'https://127.0.0.1/events',
    ]) {
      expect(() =>
        approvedWebhookUrl(url, 'https://partner.example'),
      ).toThrow();
    }
    expect(() =>
      approvedWebhookUrl('https://partner.example/events', ''),
    ).toThrow();
  });
});
