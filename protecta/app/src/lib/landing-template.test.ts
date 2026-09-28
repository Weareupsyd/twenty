import { describe, expect, it } from 'vitest';
import { browserAssetUrl } from 'src/lib/browser-asset-url';
import { renderLandingPage } from 'src/lib/landing-template';

const assets = {
  logo: '/logo.png',
  kvWebp720: '/kv-720.webp',
  kvWebp1080: '/kv-1080.webp',
  kvWebp1600: '/kv-1600.webp',
  kvJpg720: '/kv-720.jpg',
  kvJpg1080: '/kv-1080.jpg',
  kvJpg1600: '/kv-1600.jpg',
  mtn: '/mtn.svg',
  airtel: '/airtel.svg',
  stanbic: '/stanbic.jpg',
  wa: '/wa.svg',
  email: '/email.svg',
};

describe('browserAssetUrl', () => {
  it('drops the container localhost origin so the poster loads on the public host', () => {
    expect(
      browserAssetUrl(
        'http://localhost:2020/public-assets/workspace/app/public/brand/assets/key-visual-1080.jpg',
      ),
    ).toBe(
      '/public-assets/workspace/app/public/brand/assets/key-visual-1080.jpg',
    );
    expect(browserAssetUrl('/already/relative.jpg')).toBe('/already/relative.jpg');
  });
});

describe('landing page', () => {
  it('accepts the Ugandan numbers customers type and keeps the poster in frame', () => {
    const html = renderLandingPage('/s/protecta', assets, '0312246500', 'tel:+256312246500');
    expect(html).toContain('kvFallback');
    expect(html).toContain('overflow-x:clip');
    expect(html).toContain('0701440613');
    const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
    const helpers = [
      script.match(/function digits\(s\) \{[\s\S]*?\n  \}\n  function nationalUg\(s\) \{[\s\S]*?\n  \}/)?.[0],
      script.match(/function ugPhone\(s\)[\s\S]*?function emailOk\(s\) \{[\s\S]*?\n  \}/)?.[0],
    ].join('\n');
    const check = new Function(
      `${helpers}\nreturn { ugPhone, normPhone, plateOk, emailOk };`,
    )() as {
      ugPhone: (value: string) => boolean;
      normPhone: (value: string) => string;
      plateOk: (value: string) => boolean;
      emailOk: (value: string) => boolean;
    };
    expect(check.ugPhone('0701440613')).toBe(true);
    expect(check.ugPhone('256701440613')).toBe(true);
    expect(check.ugPhone('+256 701 440 613')).toBe(true);
    expect(check.normPhone('0701440613')).toBe('+256701440613');
    expect(check.plateOk('UAX 123C')).toBe(true);
    expect(check.emailOk('ada@example.com')).toBe(true);
  });
});
