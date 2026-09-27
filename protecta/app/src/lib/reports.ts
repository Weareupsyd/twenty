export type ReportRow = Record<string, unknown>;

const num = (value: unknown): number => {
  const parsed = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const sumBy = (rows: ReportRow[], field: string): number =>
  rows.reduce((total, row) => total + num(row[field]), 0);

export const countBy = (rows: ReportRow[], field: string): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = String(row[field] ?? 'UNKNOWN');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

export const groupSumBy = (
  rows: ReportRow[],
  groupField: string,
  sumField: string,
): Record<string, { count: number; total: number }> => {
  const groups: Record<string, { count: number; total: number }> = {};
  for (const row of rows) {
    const key = String(row[groupField] ?? 'UNKNOWN');
    const current = groups[key] ?? { count: 0, total: 0 };
    current.count += 1;
    current.total += num(row[sumField]);
    groups[key] = current;
  }
  return groups;
};

export const startOfTodayUtc = (now = new Date()): string =>
  now.toISOString().slice(0, 10);

export const daysBetween = (fromIsoDate: string, toIsoDate: string): number => {
  const from = new Date(`${fromIsoDate}T00:00:00Z`).getTime();
  const to = new Date(`${toIsoDate}T00:00:00Z`).getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
};

export const statementMonth = (now = new Date()): string =>
  now.toISOString().slice(0, 7);
