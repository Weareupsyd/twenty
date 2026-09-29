import { describe, expect, it } from 'vitest';
import {
  CLAIM_API_PATH,
  CLAIM_TRACK_PATH,
  PROTECTA_LANDING_PATH,
  renderClaimFormPage,
} from 'src/lib/claim-page-template';

const render = (policy = '') =>
  renderClaimFormPage({ logoUrl: '/public-assets/app/protecta-bode-logo.png', policy });

describe('claim form page', () => {
  it('shows the Protecta Bode logo and a way back to the main page', () => {
    const html = render();

    expect(html).toContain('src="/public-assets/app/protecta-bode-logo.png"');
    expect(html).toContain('alt="Protecta Bode"');
    expect(html).toContain(`href="${PROTECTA_LANDING_PATH}"`);
    expect(html).toContain('Back to main page');
  });

  it('keeps the claim fields and the API call the bot and landing page point at', () => {
    const html = render();

    for (const id of ['pol', 'phone', 'date', 'loc', 'desc']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain(`fetch('${CLAIM_API_PATH}'`);
    expect(html).toContain(`track.href='${CLAIM_TRACK_PATH}?ref='`);
  });

  it('prefills the policy number without letting a query value break the markup', () => {
    expect(render('PB-P-2026-1')).toContain('value="PB-P-2026-1"');
    expect(render('"><script>alert(1)</script>')).not.toContain('<script>alert(1)</script>');
  });

  it('fits the card in one viewport instead of a tall scrolling page', () => {
    const html = render();

    expect(html).toContain('min-height: 100dvh');
    expect(html).toContain('max-width: 540px');
    expect(html).not.toContain('padding: 32px 16px 64px');
  });
});
