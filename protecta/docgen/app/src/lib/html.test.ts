import { describe, expect, it } from 'vitest';
import { htmlToText } from 'src/lib/html';

describe('htmlToText', () => {
  it('strips tags, scripts and styles while keeping text lines', () => {
    const out = htmlToText(`
      <style>body { color: red }</style>
      <script>alert('x')</script>
      <h1>Protecta Bode</h1>
      <p>Policy <strong>PB-2026-004213</strong> &amp; cover</p>
      <ul><li>Plate: UAX 123C</li><li>Premium: UGX&nbsp;150,000</li></ul>
    `);
    expect(out).toBe(
      'Protecta Bode\nPolicy PB-2026-004213 & cover\nPlate: UAX 123C\nPremium: UGX 150,000',
    );
  });

  it('decodes common entities', () => {
    expect(htmlToText('<p>a &lt;b&gt; &quot;c&quot; &#39;d&#39;</p>')).toBe(
      `a <b> "c" 'd'`,
    );
  });
});
