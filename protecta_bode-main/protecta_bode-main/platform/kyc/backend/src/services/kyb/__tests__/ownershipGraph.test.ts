/**
 * Ownership graph tests.
 *
 * The cases that matter are the ones real corporate structures produce:
 * chains, diamonds where one person is reachable twice, circular ownership,
 * and the plain opaque holding company nobody can see behind.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveOwnershipGraph,
  computeEffectiveOwnership,
  findUnresolvedCorporateOwners,
  wouldCreateCycle,
  walkAncestry,
  UBO_THRESHOLD_PERCENT,
  MAX_NESTING_DEPTH,
  type GraphSession,
} from '../ownershipGraph.js';
import { aggregate } from '../aggregation.js';

const person = (id: string, name: string, pctVal: number | string | null) => ({
  id, full_name: name, role_tags: ['ubo' as const], ownership_percentage: pctVal,
});
const corp = (id: string, name: string, pctVal: number, childId?: string) => ({
  id, full_name: name, role_tags: ['corporate_owner' as const],
  ownership_percentage: pctVal, is_corporate: true,
  nested_business_session_id: childId ?? null,
});

// ── Flat ───────────────────────────────────────────────────────────────────
describe('a company owned only by people', () => {
  const sessions: GraphSession[] = [{
    id: 'root', legal_name: 'Acme Ltd',
    people: [person('1', 'Amina', 60), person('2', 'Joseph', 40)],
  }];

  it('is fully resolved', () => {
    const r = resolveOwnershipGraph('root', sessions);
    expect(r.resolved).toBe(true);
    expect(r.opaque_percentage).toBe(0);
    expect(r.traced_percentage).toBe(100);
  });

  it('marks both as beneficial owners above the threshold', () => {
    const owners = computeEffectiveOwnership('root', sessions);
    expect(owners.map((o) => o.full_name)).toEqual(['Amina', 'Joseph']);
    expect(owners.every((o) => o.is_beneficial_owner)).toBe(true);
  });
});

// ── The dangerous case ─────────────────────────────────────────────────────
describe('an unresolved corporate owner', () => {
  const sessions: GraphSession[] = [{
    id: 'root', legal_name: 'Acme Ltd',
    people: [person('1', 'Amina', 80), corp('2', 'Opaque Holdings Ltd', 20)],
  }];

  it('is reported as unresolved - we cannot say who owns the company', () => {
    const r = resolveOwnershipGraph('root', sessions);
    expect(r.resolved).toBe(false);
    expect(r.opaque_percentage).toBe(20);
    expect(r.unresolved_owners[0].name).toBe('Opaque Holdings Ltd');
  });

  it('is listed as needing a child session', () => {
    expect(findUnresolvedCorporateOwners(sessions)).toHaveLength(1);
  });

  it('blocks approval when nested KYB is ON', () => {
    const out = aggregate({
      keyPeople: [
        { id: '1', full_name: 'Amina', role_tags: ['ubo'], ownership_percentage: 80, kyc_status: 'APPROVED' },
        { id: '2', full_name: 'Opaque Holdings Ltd', role_tags: ['corporate_owner'], ownership_percentage: 20, is_corporate: true },
      ],
      documents: [{ document_type: 'certificate_of_incorporation', status: 'PROCESSED', tamper_check_passed: true }],
      requiredDocumentTypes: ['certificate_of_incorporation'],
      crossCheckResults: ['MATCH'],
      entityAmlRisk: 'clear',
      ownershipGraph: resolveOwnershipGraph('root', sessions),
      options: { resolveNestedOwnership: true },
    });
    expect(out.status).toBe('IN_REVIEW');
    expect(out.reasons.map((r) => r.code)).toContain('OWNERSHIP_CHAIN_OPAQUE');
    expect(out.ownership_resolved).toBe(false);
  });

  it('does NOT block when nested KYB is OFF - the toggle really is a toggle', () => {
    const out = aggregate({
      keyPeople: [
        { id: '1', full_name: 'Amina', role_tags: ['ubo'], ownership_percentage: 80, kyc_status: 'APPROVED' },
        { id: '2', full_name: 'Opaque Holdings Ltd', role_tags: ['corporate_owner'], ownership_percentage: 20, is_corporate: true },
      ],
      documents: [{ document_type: 'certificate_of_incorporation', status: 'PROCESSED', tamper_check_passed: true }],
      requiredDocumentTypes: ['certificate_of_incorporation'],
      crossCheckResults: ['MATCH'],
      entityAmlRisk: 'clear',
      ownershipGraph: resolveOwnershipGraph('root', sessions),
      options: { resolveNestedOwnership: false },
    });
    expect(out.status).toBe('APPROVED');
    expect(out.ownership_resolved).toBeUndefined();
  });
});

// ── Chains ─────────────────────────────────────────────────────────────────
describe('ownership through a chain', () => {
  // Amina owns 50% of Holdco; Holdco owns 20% of Acme -> Amina holds 10%.
  const sessions: GraphSession[] = [
    { id: 'root', legal_name: 'Acme Ltd', people: [person('1', 'Direct Dora', 80), corp('2', 'Holdco Ltd', 20, 'holdco')] },
    { id: 'holdco', legal_name: 'Holdco Ltd', parent_session_id: 'root', depth: 1,
      people: [person('3', 'Amina', 50), person('4', 'Bakari', 50)] },
  ];

  it('multiplies percentages down the chain', () => {
    const owners = computeEffectiveOwnership('root', sessions);
    expect(owners.find((o) => o.full_name === 'Amina')?.effective_percentage).toBe(10);
    expect(owners.find((o) => o.full_name === 'Bakari')?.effective_percentage).toBe(10);
    expect(owners.find((o) => o.full_name === 'Direct Dora')?.effective_percentage).toBe(80);
  });

  it('applies the threshold to the EFFECTIVE stake, not the direct one', () => {
    // Amina holds 50% of Holdco but only 10% of Acme - below 25%, so she is
    // not a beneficial owner of Acme even though she looks major upstream.
    const owners = computeEffectiveOwnership('root', sessions);
    expect(owners.find((o) => o.full_name === 'Amina')?.is_beneficial_owner).toBe(false);
    expect(owners.find((o) => o.full_name === 'Direct Dora')?.is_beneficial_owner).toBe(true);
  });

  it('records a readable ownership path', () => {
    const amina = computeEffectiveOwnership('root', sessions).find((o) => o.full_name === 'Amina');
    expect(amina?.path).toBe('Acme Ltd > Holdco Ltd > Amina');
  });

  it('is fully resolved once the child exists', () => {
    const r = resolveOwnershipGraph('root', sessions);
    expect(r.resolved).toBe(true);
    expect(r.opaque_percentage).toBe(0);
  });
});

// ── Diamond ────────────────────────────────────────────────────────────────
describe('one person reachable by two routes', () => {
  // Amina owns 30% of each of two holdcos, each holding 50% of the root.
  // 30%*50% + 30%*50% = 30% total - above the threshold only when summed.
  const sessions: GraphSession[] = [
    { id: 'root', legal_name: 'Acme Ltd', people: [corp('a', 'Alpha Ltd', 50, 'alpha'), corp('b', 'Beta Ltd', 50, 'beta')] },
    { id: 'alpha', legal_name: 'Alpha Ltd', people: [person('1', 'Amina', 30), person('2', 'Other A', 70)] },
    { id: 'beta', legal_name: 'Beta Ltd', people: [person('3', 'Amina', 30), person('4', 'Other B', 70)] },
  ];

  it('sums the stakes instead of overwriting one with the other', () => {
    const amina = computeEffectiveOwnership('root', sessions).find((o) => o.full_name === 'Amina');
    expect(amina?.effective_percentage).toBe(30);
  });

  it('crosses the threshold only because the routes were summed', () => {
    // Either route alone is 15% - under 25%. Missing this is exactly how a
    // beneficial owner hides behind a split structure.
    const amina = computeEffectiveOwnership('root', sessions).find((o) => o.full_name === 'Amina');
    expect(amina?.is_beneficial_owner).toBe(true);
    expect(15).toBeLessThan(UBO_THRESHOLD_PERCENT);
  });
});

// ── Cycles ─────────────────────────────────────────────────────────────────
describe('circular ownership', () => {
  const cyclic: GraphSession[] = [
    { id: 'a', legal_name: 'A Ltd', parent_session_id: 'b', people: [corp('1', 'B Ltd', 50, 'b')] },
    { id: 'b', legal_name: 'B Ltd', parent_session_id: 'a', people: [corp('2', 'A Ltd', 50, 'a')] },
  ];

  it('walkAncestry reports a cycle instead of looping forever', () => {
    const byId = new Map(cyclic.map((s) => [s.id, s]));
    expect(walkAncestry('a', byId)).toBeNull();
  });

  it('resolveOwnershipGraph terminates and flags the structure', () => {
    const r = resolveOwnershipGraph('a', cyclic);
    expect(r.resolved).toBe(false);
    expect(r.structural_warning).toMatch(/circular|deep/i);
  });

  it('refuses to spawn a child that would close a loop', () => {
    const tree: GraphSession[] = [
      { id: 'root', legal_name: 'Acme Ltd', people: [corp('1', 'Holdco Ltd', 50, 'holdco')] },
      { id: 'holdco', legal_name: 'Holdco Ltd', parent_session_id: 'root', people: [] },
    ];
    // Holdco claiming to be owned by Acme would point back at the root.
    expect(wouldCreateCycle('holdco', 'Acme Ltd', tree)).toBe(true);
    expect(wouldCreateCycle('holdco', 'Unrelated Ltd', tree)).toBe(false);
  });

  it('is case- and whitespace-insensitive when spotting the loop', () => {
    const tree: GraphSession[] = [
      { id: 'root', legal_name: 'Acme Ltd', people: [] },
      { id: 'child', legal_name: 'Child Ltd', parent_session_id: 'root', people: [] },
    ];
    expect(wouldCreateCycle('child', '  acme ltd  ', tree)).toBe(true);
  });
});

// ── Depth ──────────────────────────────────────────────────────────────────
describe('deep chains', () => {
  it('stops at the depth ceiling rather than recursing forever', () => {
    const sessions: GraphSession[] = [];
    for (let i = 0; i < 10; i++) {
      sessions.push({
        id: `s${i}`,
        legal_name: `Level ${i}`,
        parent_session_id: i === 0 ? null : `s${i - 1}`,
        people: [corp(`c${i}`, `Level ${i + 1}`, 100, `s${i + 1}`)],
      });
    }
    const r = resolveOwnershipGraph('s0', sessions);
    expect(r).toBeDefined();          // terminated
    expect(r.resolved).toBe(false);   // and did not claim success
  });

  it('agrees with the database ceiling', () => {
    expect(MAX_NESTING_DEPTH).toBe(5);
  });
});

// ── Data hygiene ───────────────────────────────────────────────────────────
describe('real-world data shapes', () => {
  it('handles NUMERIC arriving as a string', () => {
    const sessions: GraphSession[] = [{
      id: 'root', legal_name: 'Acme Ltd',
      people: [person('1', 'Amina', '52.000'), person('2', 'Joseph', '48.000')],
    }];
    expect(resolveOwnershipGraph('root', sessions).traced_percentage).toBe(100);
  });

  it('ignores an owner with no declared percentage rather than counting it as zero-risk', () => {
    const sessions: GraphSession[] = [{
      id: 'root', legal_name: 'Acme Ltd',
      people: [person('1', 'Amina', 100), person('2', 'Unknown Stake', null)],
    }];
    const owners = computeEffectiveOwnership('root', sessions);
    expect(owners.map((o) => o.full_name)).toEqual(['Amina']);
  });

  it('does not fall over on an empty company', () => {
    const r = resolveOwnershipGraph('root', [{ id: 'root', legal_name: 'Empty Ltd', people: [] }]);
    expect(r.resolved).toBe(true);
    expect(r.beneficial_owners).toHaveLength(0);
  });

  it('does not fall over when the root session is missing', () => {
    expect(() => resolveOwnershipGraph('nope', [])).not.toThrow();
  });
});
