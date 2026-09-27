/**
 * Risk classification - 1:1 port of app/services/risk.py.
 * Shared fixture: src/aml/__tests__/risk.test.ts mirrors tests/test_risk.py.
 */

export type RiskLevel = 'Clear' | 'Low' | 'Medium' | 'High' | 'Critical';

export const TOPIC_MAPPING: Array<[string, string]> = [
  ['sanction', 'sanction'],
  ['pep', 'pep'],
  ['debarment', 'debarment'],
  ['crime', 'crime'],
  ['wanted', 'wanted'],
  ['state', 'state'],
  ['export.control', 'export_control'],
];

export const RISK_TOPIC_THRESHOLDS: Record<string, number> = {
  sanction: 0.75,
  wanted: 0.75,
  debarment: 0.75,
};

export function classifyTopics(topics: unknown): Record<string, boolean> {
  let list: unknown[] = [];
  if (Array.isArray(topics)) list = topics;
  else if (typeof topics === 'string') list = [topics];

  const result: Record<string, boolean> = {};
  for (const [prefix, category] of TOPIC_MAPPING) {
    result[category] = list.some((t) => String(t).toLowerCase().startsWith(prefix));
  }
  return result;
}

export function riskCategoriesFromTopics(topics: unknown): string[] {
  const flags = classifyTopics(topics);
  return Object.entries(flags).filter(([, active]) => active).map(([cat]) => cat);
}

export function riskLevelForMatches(
  matches: Array<{ score: number; topics?: unknown }>,
  flagThreshold = 0.8,
): RiskLevel {
  if (!matches.length) return 'Clear';

  const maxScore = Math.max(...matches.map((m) => m.score));

  for (const m of matches) {
    const cats = riskCategoriesFromTopics(m.topics || []);
    if ((cats.includes('sanction') || cats.includes('wanted')) && m.score >= 0.8) {
      return 'Critical';
    }
  }
  if (maxScore >= 0.97) return 'Critical';

  for (const m of matches) {
    const cats = riskCategoriesFromTopics(m.topics || []);
    if (cats.length && m.score >= (RISK_TOPIC_THRESHOLDS[cats[0]] ?? 0.75)) {
      return 'High';
    }
  }

  if (maxScore >= 0.9) return 'High';
  if (maxScore >= flagThreshold) return 'Medium';
  if (maxScore >= 0.6) return 'Low';
  return 'Clear';
}

export function summaryFromMatches(
  matches: Array<{ score: number; topics?: unknown }>,
  riskLevel: string,
): {
  match_found: boolean;
  risk_level: string;
  requires_human_review: boolean;
  total_matches: number;
  sanctions_matches: number;
  pep_related_matches: number;
} {
  let sanctions = 0;
  let pep = 0;
  for (const m of matches) {
    const cats = riskCategoriesFromTopics(m.topics || []);
    if (cats.includes('sanction')) sanctions += 1;
    if (cats.includes('pep')) pep += 1;
  }
  return {
    match_found: matches.length > 0,
    risk_level: riskLevel,
    requires_human_review: riskLevel === 'High' || riskLevel === 'Critical' || sanctions > 0,
    total_matches: matches.length,
    sanctions_matches: sanctions,
    pep_related_matches: pep,
  };
}
