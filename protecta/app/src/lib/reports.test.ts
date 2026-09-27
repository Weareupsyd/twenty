import { describe, expect, it } from 'vitest';
import { countBy, daysBetween, groupSumBy, sumBy } from 'src/lib/reports';

describe('aggregations', () => {
  it('sums, counts and groups rows', () => {
    const rows = [
      { status: 'CONFIRMED', amountUgx: 100 },
      { status: 'PENDING', amountUgx: 50 },
      { status: 'CONFIRMED', amountUgx: '25' },
    ];
    expect(sumBy(rows, 'amountUgx')).toBe(175);
    expect(countBy(rows, 'status')).toEqual({ CONFIRMED: 2, PENDING: 1 });
    expect(groupSumBy(rows, 'status', 'amountUgx')).toEqual({
      CONFIRMED: { count: 2, total: 125 },
      PENDING: { count: 1, total: 50 },
    });
  });

  it('computes day gaps between ISO dates', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
  });
});
