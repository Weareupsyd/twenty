/** Pure Phase 4 mappers - Kabila addon rows -> aml.screening_requests + links. */

export type KabilaRisk = string | null | undefined;

export function mapKabilaRisk(level: KabilaRisk): string {
  switch (String(level || 'clear').toLowerCase()) {
    case 'clear': return 'Clear';
    case 'potential_match': return 'Medium';
    case 'confirmed_match': return 'High';
    case 'low': return 'Low';
    case 'medium': return 'Medium';
    case 'high': return 'High';
    case 'critical': return 'Critical';
    default: {
      const raw = String(level || 'Clear');
      return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    }
  }
}

export function normalizeName(name: string | null | undefined): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function kabilaScreenRef(id: string, prefix: 'KAB' | 'KYB' = 'KAB'): string {
  const hex = String(id || '').replace(/-/g, '').slice(0, 10).toUpperCase();
  return `SCR-${prefix}-${hex}`;
}

export type CoverageCounts = {
  verified: number;
  historicallyScreened: number;
  linked: number;
};

export type CoverageVerdict = {
  period: string;
  verified_subjects: number;
  screened_subjects: number;
  historically_screened: number;
  unscreened: number;
  unlinked: number;
  coverage_pct: number | null;
  migrated_pct: number | null;
  passed: boolean;
  rehearsal: false;
  generated_at: string;
  note: string;
};

export function coverageVerdict(counts: CoverageCounts, generatedAt = new Date().toISOString()): CoverageVerdict {
  const verified = Math.max(0, counts.verified);
  const historical = Math.max(0, counts.historicallyScreened);
  const linked = Math.max(0, counts.linked);
  const unlinked = Math.max(0, historical - linked);
  const unscreened = Math.max(0, verified - linked);
  const coveragePct = verified === 0 ? null : Math.round((Math.min(linked, verified) / verified) * 1000) / 10;
  const migratedPct = historical === 0 ? 100 : Math.round((Math.min(linked, historical) / historical) * 1000) / 10;
  return {
    period: 'all',
    verified_subjects: verified,
    screened_subjects: linked,
    historically_screened: historical,
    unscreened,
    unlinked,
    coverage_pct: coveragePct,
    migrated_pct: migratedPct,
    passed: unlinked === 0,
    rehearsal: false,
    generated_at: generatedAt,
    note: unlinked === 0
      ? 'Coverage attestation passed. Every historical screen is linked on the subject file.'
      : `Coverage gap. ${unlinked} historical screen(s) still unlinked.`,
  };
}

export type PlannedCopy = {
  kind: 'kabila' | 'kyb' | 'staff' | 'name-link';
  id: string;
  reference?: string;
  name?: string;
};

export function planKabilaCopies(rows: Array<{ id: string; full_name: string }>): PlannedCopy[] {
  return rows.map((r) => ({
    kind: 'kabila',
    id: r.id,
    reference: kabilaScreenRef(r.id, 'KAB'),
    name: r.full_name,
  }));
}

export function planNameLinks(opts: {
  verifications: Array<{ id: string; name: string }>;
  screenings: Array<{ reference: string; name: string }>;
  existing: Array<{ verification_id: string; screening_ref: string }>;
}): PlannedCopy[] {
  const have = new Set(opts.existing.map((e) => `${e.verification_id}|${e.screening_ref}`));
  const out: PlannedCopy[] = [];
  for (const v of opts.verifications) {
    const key = normalizeName(v.name);
    if (!key) continue;
    for (const s of opts.screenings) {
      if (normalizeName(s.name) !== key) continue;
      if (have.has(`${v.id}|${s.reference}`)) continue;
      out.push({ kind: 'name-link', id: v.id, reference: s.reference, name: v.name });
      have.add(`${v.id}|${s.reference}`);
    }
  }
  return out;
}
