import { describe, expect, it } from 'vitest';
import {
  classifyTopics,
  riskCategoriesFromTopics,
  riskLevelForMatches,
  summaryFromMatches,
} from '../risk.js';

describe('classifyTopics', () => {
  it('flags sanction', () => {
    const flags = classifyTopics(['sanction']);
    expect(flags.sanction).toBe(true);
    expect(flags.pep).toBe(false);
  });

  it('flags pep and crime prefixes', () => {
    const flags = classifyTopics(['sanction', 'pep', 'crime.fraud']);
    expect(flags.sanction).toBe(true);
    expect(flags.pep).toBe(true);
    expect(flags.crime).toBe(true);
  });

  it('flags export.control', () => {
    const flags = classifyTopics(['sanction', 'export.control']);
    expect(flags.sanction).toBe(true);
    expect(flags.export_control).toBe(true);
  });

  it('handles null', () => {
    const flags = classifyTopics(null);
    expect(flags.sanction).toBe(false);
    expect(flags.pep).toBe(false);
  });

  it('handles string input', () => {
    expect(classifyTopics('wanted').wanted).toBe(true);
  });
});

describe('riskCategoriesFromTopics', () => {
  it('returns active names', () => {
    const cats = riskCategoriesFromTopics(['sanction', 'pep']);
    expect(cats).toContain('sanction');
    expect(cats).toContain('pep');
    expect(cats).not.toContain('crime');
  });
});

describe('riskLevelForMatches', () => {
  it('is Clear with no matches', () => {
    expect(riskLevelForMatches([])).toBe('Clear');
  });

  it('is Critical for a strong sanction hit', () => {
    expect(riskLevelForMatches([{ score: 0.95, topics: ['sanction'] }])).toBe('Critical');
  });

  it('is High for a high score without topics', () => {
    expect(riskLevelForMatches([{ score: 0.92, topics: [] }])).toBe('High');
  });

  it('is Medium around the flag threshold', () => {
    expect(riskLevelForMatches([{ score: 0.85, topics: [] }])).toBe('Medium');
  });

  it('is Low for a weak score', () => {
    expect(riskLevelForMatches([{ score: 0.65, topics: [] }])).toBe('Low');
  });

  it('is High for a PEP at 0.80', () => {
    expect(riskLevelForMatches([{ score: 0.8, topics: ['pep'] }])).toBe('High');
  });
});

describe('summaryFromMatches', () => {
  it('counts sanctions and pep', () => {
    const summary = summaryFromMatches(
      [
        { score: 0.95, topics: ['sanction'] },
        { score: 0.9, topics: ['pep'] },
      ],
      'Critical',
    );
    expect(summary.match_found).toBe(true);
    expect(summary.requires_human_review).toBe(true);
    expect(summary.total_matches).toBe(2);
    expect(summary.sanctions_matches).toBe(1);
    expect(summary.pep_related_matches).toBe(1);
  });

  it('is clear with no matches', () => {
    const summary = summaryFromMatches([], 'Clear');
    expect(summary.match_found).toBe(false);
    expect(summary.requires_human_review).toBe(false);
    expect(summary.total_matches).toBe(0);
  });

  it('requires review for High PEP', () => {
    const summary = summaryFromMatches([{ score: 0.85, topics: ['pep'] }], 'High');
    expect(summary.requires_human_review).toBe(true);
  });
});
