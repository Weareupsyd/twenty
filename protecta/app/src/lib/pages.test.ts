import { describe, expect, it } from 'vitest';
import { renderPolicyPage, renderQuotePage } from 'src/lib/pages';

const policy = {
  policyNo: 'PB-2026-000123',
  status: 'ACTIVE',
  plate: 'UAB 123X',
  vehicleMake: 'Toyota',
  vehicleModel: 'RAV4',
  premiumUgx: 150000,
  policyholderPhone: '+256701440613',
  periodStart: '2026-01-01',
  periodEnd: '2026-12-31',
};

describe('renderPolicyPage', () => {
  it('offers one phone-verified policy download and no print or generate actions', () => {
    const html = renderPolicyPage(policy);

    expect(html).toContain('Download full policy PDF');
    expect(html).toContain("'/s/docgen/documents/view?policyNo='");
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).not.toContain('Print certificate');
    expect(html).not.toContain('Generate policy document');
    expect(html).toContain('/s/docgen/documents/view?policyNo=');
    expect(html).not.toContain('/s/protecta/policies/pdf?ref=');
    expect(html).not.toContain('+256701440613');
  });

  it('routes an already-paid quote to the full policy page, not the one-page certificate', () => {
    const html = renderQuotePage(
      {
        reference: 'QUOTE-123',
        status: 'ACCEPTED',
        plate: 'UAB 123X',
        vehicleMake: 'Toyota',
        vehicleModel: 'RAV4',
        vehicleValue: 10_000_000,
        premium: 150_000,
      },
      '',
    );

    expect(html).toContain('/s/protecta/policies/doc?ref=QUOTE-123');
    expect(html).toContain('Download full policy PDF');
    expect(html).not.toContain('/s/protecta/policies/pdf?ref=');
    expect(html).not.toContain('View policy</a>');
  });
});
