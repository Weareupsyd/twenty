/**
 * Ownership graph - resolving corporate owners to natural persons.
 *
 * A corporate shareholder is a hole in the graph. Until we know who owns it,
 * we do not know who owns the company, which is the entire question UBO
 * discovery exists to answer. These functions walk the chain, multiply the
 * percentages through it, and decide which natural persons cross the
 * beneficial-ownership threshold.
 *
 * Pure and IO-free - the service layer loads the rows and calls these.
 */

import type { RoleTag } from './roleTags.js';

/** FATF's conventional threshold for beneficial ownership. */
export const UBO_THRESHOLD_PERCENT = 25;

/** Matches the database CHECK. Deeper than this and an analyst should look. */
export const MAX_NESTING_DEPTH = 5;

export interface GraphPerson {
  id: string;
  full_name: string;
  role_tags: RoleTag[];
  ownership_percentage?: number | string | null;
  is_corporate?: boolean;
  /** Set once a child session has been opened for a corporate owner. */
  nested_business_session_id?: string | null;
}

export interface GraphSession {
  id: string;
  legal_name?: string | null;
  status?: string | null;
  parent_session_id?: string | null;
  depth?: number;
  people: GraphPerson[];
}

/** Coerce Postgres NUMERIC (arrives as a string) to a number. */
function pct(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// ── Unresolved corporate owners ────────────────────────────────────────────

export interface UnresolvedOwner {
  person: GraphPerson;
  sessionId: string;
  /** Ownership of the immediate parent, not of the root. */
  directPercentage: number | null;
}

/**
 * Corporate owners with no child session yet - the holes in the graph.
 *
 * These are what `spawnNestedKyb` acts on, and what blocks approval while
 * they remain open.
 */
export function findUnresolvedCorporateOwners(sessions: GraphSession[]): UnresolvedOwner[] {
  const out: UnresolvedOwner[] = [];
  for (const session of sessions) {
    for (const person of session.people) {
      if (!person.is_corporate) continue;
      if (person.nested_business_session_id) continue;
      out.push({ person, sessionId: session.id, directPercentage: pct(person.ownership_percentage) });
    }
  }
  return out;
}

// ── Cycle detection ────────────────────────────────────────────────────────

/**
 * Walk from a session up to its root, returning the ancestry.
 *
 * Circular ownership is a real structure (A owns B, B owns A), not a
 * hypothetical - so every traversal is bounded and reports a cycle rather
 * than looping. Returns null when a cycle is detected.
 */
export function walkAncestry(
  sessionId: string,
  byId: Map<string, GraphSession>,
): string[] | null {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | null | undefined = sessionId;

  while (current) {
    if (seen.has(current)) return null; // cycle
    seen.add(current);
    chain.push(current);
    if (chain.length > MAX_NESTING_DEPTH + 1) return null; // runaway
    current = byId.get(current)?.parent_session_id ?? null;
  }
  return chain;
}

/**
 * Would linking `childId` under `parentId` create a cycle?
 *
 * Called before a nested session is created. Without it, an offshore
 * structure where two companies own each other would spawn sessions until
 * the depth constraint tripped.
 */
export function wouldCreateCycle(
  parentId: string,
  childCompanyName: string,
  sessions: GraphSession[],
): boolean {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const ancestry = walkAncestry(parentId, byId);
  if (ancestry === null) return true;

  const target = childCompanyName.trim().toLowerCase();
  return ancestry.some((id) => (byId.get(id)?.legal_name ?? '').trim().toLowerCase() === target);
}

// ── Effective ownership ────────────────────────────────────────────────────

export interface EffectiveOwner {
  person_id: string;
  full_name: string;
  /** Stake in the ROOT company, multiplied through the chain. */
  effective_percentage: number;
  /** e.g. 'Acme Ltd > Holdco Ltd > Amina Warsame' */
  path: string;
  /** True once effective ownership crosses the threshold. */
  is_beneficial_owner: boolean;
  depth: number;
}

/**
 * Flatten the tree to the natural persons behind the root company.
 *
 * Percentages multiply down the chain: 50% of a company that owns 20% of the
 * root is a 10% effective stake. A person reachable by several paths (common
 * in group structures) has their stakes summed - otherwise a beneficial owner
 * who holds 15% twice would look like they hold 15% and slip under the
 * threshold.
 */
export function computeEffectiveOwnership(
  rootSessionId: string,
  sessions: GraphSession[],
  thresholdPercent: number = UBO_THRESHOLD_PERCENT,
): EffectiveOwner[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const accumulated = new Map<string, EffectiveOwner>();

  function visit(sessionId: string, multiplier: number, path: string[], depth: number, visited: Set<string>) {
    if (depth > MAX_NESTING_DEPTH) return;
    if (visited.has(sessionId)) return; // cycle guard on this branch
    const session = byId.get(sessionId);
    if (!session) return;

    const branchVisited = new Set(visited).add(sessionId);
    const label = session.legal_name || 'Unnamed company';
    const here = [...path, label];

    for (const person of session.people) {
      const direct = pct(person.ownership_percentage);

      if (person.is_corporate) {
        // Recurse into the child company, carrying the multiplier.
        if (!person.nested_business_session_id || direct === null) continue;
        visit(person.nested_business_session_id, multiplier * (direct / 100), here, depth + 1, branchVisited);
        continue;
      }

      if (direct === null || direct <= 0) continue;

      const effective = multiplier * direct;
      const key = person.full_name.trim().toLowerCase();
      const existing = accumulated.get(key);

      if (existing) {
        // Same human reached by two routes - sum, don't overwrite.
        existing.effective_percentage = Number((existing.effective_percentage + effective).toFixed(6));
        existing.is_beneficial_owner = existing.effective_percentage >= thresholdPercent;
        if (depth < existing.depth) {
          existing.path = [...here, person.full_name].join(' > ');
          existing.depth = depth;
        }
      } else {
        accumulated.set(key, {
          person_id: person.id,
          full_name: person.full_name,
          effective_percentage: Number(effective.toFixed(6)),
          path: [...here, person.full_name].join(' > '),
          is_beneficial_owner: effective >= thresholdPercent,
          depth,
        });
      }
    }
  }

  visit(rootSessionId, 1, [], 0, new Set());

  return [...accumulated.values()].sort((a, b) => b.effective_percentage - a.effective_percentage);
}

// ── Resolution status ──────────────────────────────────────────────────────

export interface GraphResolution {
  resolved: boolean;
  /** Ownership we can trace to a natural person, as a % of the root. */
  traced_percentage: number;
  /** Ownership sitting behind an unresolved corporate owner. */
  opaque_percentage: number;
  unresolved_owners: Array<{ name: string; session_id: string; direct_percentage: number | null }>;
  beneficial_owners: EffectiveOwner[];
  /** Set when the structure could not be walked (cycle or over-depth). */
  structural_warning?: string;
}

/**
 * Can we say who ultimately owns this company?
 *
 * This is the question that decides whether a business with a corporate
 * shareholder may be approved. `resolved: false` means part of the ownership
 * is behind a company we know nothing about.
 */
export function resolveOwnershipGraph(
  rootSessionId: string,
  sessions: GraphSession[],
  thresholdPercent: number = UBO_THRESHOLD_PERCENT,
): GraphResolution {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const beneficialOwners = computeEffectiveOwnership(rootSessionId, sessions, thresholdPercent);

  let structuralWarning: string | undefined;
  for (const session of sessions) {
    if (walkAncestry(session.id, byId) === null) {
      structuralWarning = 'Circular or excessively deep ownership detected - manual review required';
      break;
    }
  }

  // Opaque ownership: corporate owners with no child session, weighted by
  // their position in the chain.
  let opaque = 0;
  const unresolved: GraphResolution['unresolved_owners'] = [];

  function scan(sessionId: string, multiplier: number, depth: number, visited: Set<string>) {
    if (depth > MAX_NESTING_DEPTH || visited.has(sessionId)) return;
    const session = byId.get(sessionId);
    if (!session) return;
    const branchVisited = new Set(visited).add(sessionId);

    for (const person of session.people) {
      if (!person.is_corporate) continue;
      const direct = pct(person.ownership_percentage);

      if (!person.nested_business_session_id) {
        const weighted = direct === null ? 0 : multiplier * direct;
        opaque += weighted;
        unresolved.push({ name: person.full_name, session_id: sessionId, direct_percentage: direct });
        continue;
      }
      if (direct !== null) {
        scan(person.nested_business_session_id, multiplier * (direct / 100), depth + 1, branchVisited);
      }
    }
  }
  scan(rootSessionId, 1, 0, new Set());

  const traced = beneficialOwners.reduce((s, o) => s + o.effective_percentage, 0);

  return {
    resolved: unresolved.length === 0 && !structuralWarning,
    traced_percentage: Number(traced.toFixed(6)),
    opaque_percentage: Number(opaque.toFixed(6)),
    unresolved_owners: unresolved,
    beneficial_owners: beneficialOwners,
    ...(structuralWarning ? { structural_warning: structuralWarning } : {}),
  };
}
