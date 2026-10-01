import { afterEach, describe, expect, it } from 'vitest';
import {
  maskedUgPhone,
  renderInvoiceHtml,
  renderReceiptHtml,
} from 'src/lib/billing-document-html';
import { PROTECTA_LOGO_PNG_BASE64 } from 'src/lib/brand-logo';

const quote = {
  reference: '482913',
  status: 'QUOTED',
  premium: 150000,
  validUntil: '31 Oct 2026',
  createdAt: '2026-09-29T10:00:00.000Z',
  policyholderPhone: '+256772000000',
  plate: 'UAX 123C',
  vehicleMake: 'Toyota',
  vehicleModel: 'Premio',
  vehicleValue: 10000000,
  shareUrl: 'https://protectabode.weareupsyd.com/s/protecta/quotes/view?ref=482913',
};

const payment = {
  id: 'pay-1',
  protectaRef: 'R-1001',
  paymentRef: 'MTN-88412',
  quoteRef: '482913',
  provider: 'MTN',
  providerRef: 'MTN-88412',
  payerPhone: '+256772000000',
  amountUgx: 150000,
  status: 'CONFIRMED',
  createdAt: '2026-09-30T09:00:00.000Z',
};

const policy = {
  policyNo: 'PB-2026-0007',
  periodStart: '30 Sep 2026',
  periodEnd: '29 Sep 2027',
  premiumUgx: 150000,
  trainingLevyUgx: 1000,
  vatUgx: 0,
  stampDutyUgx: 5000,
};

afterEach(() => {
  delete process.env.SUPPORT_PHONE;
  delete process.env.SUPPORT_EMAIL;
});

describe('the samples are rebranded, not copied', () => {
  it('carries the Protecta Bode logo and none of the sample brand', () => {
    const html = renderInvoiceHtml({ quote });
    expect(html).toContain(`data:image/png;base64,${PROTECTA_LOGO_PNG_BASE64.slice(0, 24)}`);
    expect(html).toContain('alt="Protecta Bode"');
    for (const leftover of [
      'AgriLink',
      'agrilink',
      'Maize',
      'Tuktuk',
      'escrow',
      'commission (2%)',
      '+256 787 165 331',
      'upload.wikimedia.org',
    ]) {
      expect(html.toLowerCase()).not.toContain(leftover.toLowerCase());
    }
  });

  it('keeps the sample design language: type, rules and the flag', () => {
    const html = renderInvoiceHtml({ quote });
    expect(html).toContain('--ink: #111111');
    expect(html).toContain('class="doc-head"');
    expect(html).toContain('class="totals-row grand"');
    expect(html).toContain('dflag dflag-ug');
    // The flag is inline so an offline renderer still prints it.
    expect(html).toContain('data:image/svg+xml,');
    // Only the numeric columns are right-aligned, as in the samples.
    expect(html).toContain('<th>Description</th>');
    expect(html).toContain('<th class="r">Amount</th>');
  });

  it('keeps the receipt banner left-aligned under the header', () => {
    const html = renderReceiptHtml({ payment, quote });
    expect(html).toContain('<th>Item</th>');
    expect(html).toContain('<th class="r">Amount</th>');
  });
});

describe('renderInvoiceHtml', () => {
  it('fills the invoice from the quote', () => {
    const html = renderInvoiceHtml({
      quote,
      name: 'Jane Doe',
      payerPhone: '+256772000000',
      payUrl: quote.shareUrl,
    });
    expect(html).toContain('<title>Invoice INV-482913');
    expect(html).toContain('<div class="dn">INV-482913</div>');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('Toyota Premio');
    expect(html).toContain('Plate UAX 123C');
    expect(html).toContain('#482913');
    expect(html).toContain('31 Oct 2026');
    expect(html).toContain('UGX 150,000');
    expect(html).toContain('Stanbic Bank Uganda');
    expect(html).toContain('9030005603063');
    expect(html).toContain(quote.shareUrl);
    expect(html).toContain('Amount due: UGX 150,000');
  });

  it('masks the payer phone behind the Ugandan flag', () => {
    const html = renderInvoiceHtml({ quote, payerPhone: '+256772008890' });
    expect(html).toContain('77\u2022\u2022 8890');
    expect(html).not.toContain('772008890');
  });

  it('prints the configured support line', () => {
    process.env.SUPPORT_PHONE = '+256312246500';
    process.env.SUPPORT_EMAIL = 'support@protectabode.example';
    const html = renderInvoiceHtml({ quote });
    expect(html).toContain('href="tel:+256312246500"');
    expect(html).toContain('support@protectabode.example');
  });

  it('escapes customer-supplied text', () => {
    const html = renderInvoiceHtml({
      quote,
      name: 'Jo & Co <script>alert(1)</script>',
    });
    expect(html).toContain('Jo &amp; Co &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

describe('renderReceiptHtml', () => {
  it('fills the receipt from the payment and the policy it bought', () => {
    const html = renderReceiptHtml({ payment, quote, policy, name: 'Jane Doe' });
    expect(html).toContain('<title>Receipt RCP-R-1001');
    expect(html).toContain('<div class="dn">RCP-R-1001</div>');
    expect(html).toContain('Paid via <b>MTN MoMo</b>');
    expect(html).toContain('#MTN-88412');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('Total received');
    expect(html).toContain('UGX 150,000');
    expect(html).toContain('PB-2026-0007');
    expect(html).toContain('30 Sep 2026');
    expect(html).toContain('Received UGX 150,000');
  });

  it('names the provider that took the money', () => {
    expect(renderReceiptHtml({ payment: { ...payment, provider: 'AIRTEL' }, quote })).toContain(
      'Paid via <b>Airtel Money</b>',
    );
    expect(
      renderReceiptHtml({ payment: { ...payment, provider: 'STANBIC' }, quote }),
    ).toContain('Paid via <b>Bank transfer</b>');
    expect(renderReceiptHtml({ payment: { ...payment, provider: '' }, quote })).toContain(
      'Paid via <b>MTN MoMo</b>',
    );
  });
});

describe('maskedUgPhone', () => {
  it('shows two digits, a masked middle and the last four', () => {
    expect(maskedUgPhone('+256772008890')).toBe('77\u2022\u2022 8890');
    expect(maskedUgPhone('0772008890')).toBe('77\u2022\u2022 8890');
    expect(maskedUgPhone('772008890')).toBe('77\u2022\u2022 8890');
  });
  it('leaves values it cannot mask alone', () => {
    expect(maskedUgPhone('')).toBe('\u2014');
    expect(maskedUgPhone('12345')).toBe('12345');
  });
});
