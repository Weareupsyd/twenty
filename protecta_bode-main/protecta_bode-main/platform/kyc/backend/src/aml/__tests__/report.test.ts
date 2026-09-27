import { describe, expect, it } from 'vitest';
import { buildSimplePdf } from '../report.js';
import { formatMatch } from '../screen.js';

describe('PDF writer', () => {
  it('emits a %PDF header', () => {
    const buf = buildSimplePdf(['Kabila Compliance', 'Reference: SCR-1']);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.toString()).toContain('Kabila Compliance');
    expect(buf.toString()).toContain('%%EOF');
  });
});

describe('formatMatch', () => {
  it('shapes a raw yente hit', () => {
    const shaped = formatMatch({
      id: 'Q1',
      caption: 'Example',
      score: 0.91234,
      schema: 'Person',
      topics: ['sanction'],
      datasets: ['default'],
      properties: { country: ['ug'], alias: ['Ex'] },
    });
    expect(shaped.entity_id).toBe('Q1');
    expect(shaped.score).toBe(0.9123);
    expect(shaped.risk_categories).toContain('sanction');
    expect((shaped.source_links as Array<{ url: string }>)[0].url).toContain('Q1');
  });
});
