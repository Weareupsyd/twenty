/**
 * Business verdict aggregation.
 *
 * Pure functions - no database, no IO. The route layer loads the rows, calls
 * these, and persists the answer. Keeping it pure is what makes the decision
 * rules straightforward to test, which matters because this is the part that
 * decides whether a company gets onboarded.
 */

import type { RoleTag, RolePolicy } from './roleTags.js';
import { personRequiresKyc, personRequiresNestedKyb } from './roleTags.js';
import type { GraphResolution } from './ownershipGraph.js';

export type BusinessStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'AWAITING_USER'
  | 'IN_REVIEW'
  | 'RESUBMITTED'
  | 'APPROVED'
  | 'DECLINED';

export type CrossCheckResult = 'MATCH' | 'INCONSISTENT' | 'UNCORROBORATED' | 'DEFERRED';

export interface KeyPersonState {
  id: string;
  full_name: string;
  role_tags: RoleTag[];
  /**
   * Postgres NUMERIC arrives over the wire as a *string* ("52.000"), not a
   * number - node-postgres does that deliberately to avoid float precision
   * loss. Accept both, and coerce at the point of use, or ownership silently
   * fails to reconcile and clean companies never leave review.
   */
  ownership_percentage?: number | string | null;
  is_corporate?: boolean;
  /** Status of the linked child KYC, when one was spawned. */
  kyc_status?: string | null;
  /** Person-level AML outcome. */
  aml_risk_level?: 'clear' | 'potential_match' | 'confirmed_match' | null;
}

export interface DocumentState {
  document_type: string;
  status?: string | null;
  tamper_check_passed?: boolean | null;
}

export interface AggregationInput {
  keyPeople: KeyPersonState[];
  documents: DocumentState[];
  requiredDocumentTypes: string[];
  crossCheckResults: CrossCheckResult[];
  entityAmlRisk?: 'clear' | 'potential_match' | 'confirmed_match' | null;
  policy?: RolePolicy;
  /**
   * Resolution of the corporate ownership chain, when nested KYB is enabled.
   * Omit it entirely and the nested-KYB rules simply don't apply - which is
   * what makes the feature switchable per workflow.
   */
  ownershipGraph?: GraphResolution | null;
  /** Workflow toggles, mirroring the KYB workflow screen. */
  options?: {
    autoApproveWhenClean?: boolean;
    sanctionsHitDeclines?: boolean;
    pepRoutesToReview?: boolean;
    inconsistencyRoutesToReview?: boolean;
    requireOwnershipReconciliation?: boolean;
    /**
     * Nested KYB. When on, a corporate owner we cannot see behind blocks
     * approval. Off, and a corporate shareholder is accepted at face value -
     * appropriate for low-risk products, not for regulated onboarding.
     */
    resolveNestedOwnership?: boolean;
  };
}

export interface AggregationReason {
  code: string;
  detail: string;
}

export interface AggregationOutcome {
  status: BusinessStatus;
  reasons: AggregationReason[];
  ubo_kyc_summary: {
    required: number;
    resolved: number;
    approved: number;
    declined: number;
    pending: number;
  };
  ownership_total: number | null;
  ownership_reconciles: boolean;
  /** Present only when nested KYB is enabled for the workflow. */
  ownership_resolved?: boolean;
  opaque_ownership_percentage?: number;
}

const DEFAULT_OPTIONS: Required<NonNullable<AggregationInput['options']>> = {
  autoApproveWhenClean: true,
  sanctionsHitDeclines: true,
  pepRoutesToReview: true,
  inconsistencyRoutesToReview: true,
  requireOwnershipReconciliation: true,
  resolveNestedOwnership: false,
};

/** Terminal child states. Anything else is still in flight. */
const CHILD_RESOLVED = new Set(['APPROVED', 'DECLINED']);

/**
 * Ownership must add up. We tolerate a small epsilon because percentages get
 * rounded on the way in (three thirds of a company is 33.333% each).
 */
const OWNERSHIP_EPSILON = 0.5;

export function summariseChildKyc(people: KeyPersonState[], policy: RolePolicy = {}) {
  let required = 0;
  let approved = 0;
  let declined = 0;
  let pending = 0;

  for (const p of people) {
    if (!personRequiresKyc(p.role_tags, policy)) continue;
    required++;
    const st = (p.kyc_status ?? '').toUpperCase();
    if (st === 'APPROVED') approved++;
    else if (st === 'DECLINED') declined++;
    else pending++;
  }

  return { required, resolved: approved + declined, approved, declined, pending };
}

/**
 * Total declared ownership. Only tags that actually carry a percentage count,
 * and a person carrying several ownership tags is counted once - otherwise a
 * UBO who is also a shareholder would be double-counted and the total would
 * never reconcile.
 */
/** Coerce a NUMERIC-or-number-or-null percentage to a usable number. */
export function toPercent(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function totalOwnership(people: KeyPersonState[]): number | null {
  const values = people
    .map((p) => toPercent(p.ownership_percentage))
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return Number(values.reduce((a, b) => a + b, 0).toFixed(3));
}

export function aggregate(input: AggregationInput): AggregationOutcome {
  const opts = { ...DEFAULT_OPTIONS, ...(input.options ?? {}) };
  const policy = input.policy ?? {};
  const reasons: AggregationReason[] = [];

  const summary = summariseChildKyc(input.keyPeople, policy);
  const ownership = totalOwnership(input.keyPeople);
  const reconciles =
    ownership === null ? false : Math.abs(ownership - 100) <= OWNERSHIP_EPSILON;

  // ── Hard declines first. A sanctions hit is not something an analyst
  //    talks their way past, so it short-circuits everything below.
  const sanctioned: string[] = [];
  if (input.entityAmlRisk === 'confirmed_match') sanctioned.push('company entity');
  for (const p of input.keyPeople) {
    if (p.aml_risk_level === 'confirmed_match') sanctioned.push(p.full_name);
  }
  // Graph fields ride along on every outcome so callers don't have to know
  // which branch produced it.
  const graph = input.ownershipGraph;
  const graphFields = opts.resolveNestedOwnership && graph
    ? { ownership_resolved: graph.resolved, opaque_ownership_percentage: graph.opaque_percentage }
    : {};

  if (opts.sanctionsHitDeclines && sanctioned.length > 0) {
    return {
      status: 'DECLINED',
      reasons: [{ code: 'AML_CONFIRMED_MATCH', detail: `Confirmed sanctions match: ${sanctioned.join(', ')}` }],
      ubo_kyc_summary: summary,
      ownership_total: ownership,
      ownership_reconciles: reconciles,
      ...graphFields,
    };
  }

  // A declined child KYC declines the parent - we cannot onboard a company
  // whose required owner failed identity verification.
  const declinedPeople = input.keyPeople.filter(
    (p) => personRequiresKyc(p.role_tags, policy) && (p.kyc_status ?? '').toUpperCase() === 'DECLINED',
  );
  if (declinedPeople.length > 0) {
    return {
      status: 'DECLINED',
      reasons: [{
        code: 'LINKED_KYC_DECLINED',
        detail: `Required KYC declined for: ${declinedPeople.map((p) => p.full_name).join(', ')}`,
      }],
      ubo_kyc_summary: summary,
      ownership_total: ownership,
      ownership_reconciles: reconciles,
      ...graphFields,
    };
  }

  // ── Still waiting on the applicant? ─────────────────────────────────────
  const presentTypes = new Set(
    input.documents.filter((d) => (d.status ?? '').toUpperCase() !== 'PENDING').map((d) => d.document_type),
  );
  const missingDocs = input.requiredDocumentTypes.filter((t) => !presentTypes.has(t));
  if (missingDocs.length > 0) {
    reasons.push({ code: 'DOCUMENTS_MISSING', detail: `Awaiting: ${missingDocs.join(', ')}` });
  }

  if (summary.pending > 0) {
    reasons.push({
      code: 'LINKED_KYC_PENDING',
      detail: `${summary.pending} of ${summary.required} required KYC sessions unresolved`,
    });
  }

  // The parent stays open until every required child resolves. This is the
  // rule that removes the spreadsheet chase.
  if (missingDocs.length > 0 || summary.pending > 0) {
    return {
      status: 'AWAITING_USER',
      reasons,
      ubo_kyc_summary: summary,
      ownership_total: ownership,
      ownership_reconciles: reconciles,
      ...graphFields,
    };
  }

  // ── Everything is in. Does anything need a human? ───────────────────────
  const inconsistent = input.crossCheckResults.filter((r) => r === 'INCONSISTENT').length;
  if (opts.inconsistencyRoutesToReview && inconsistent > 0) {
    reasons.push({ code: 'CROSS_CHECK_INCONSISTENT', detail: `${inconsistent} field(s) disagree across sources` });
  }

  const uncorroborated = input.crossCheckResults.filter((r) => r === 'UNCORROBORATED').length;
  if (uncorroborated > 0) {
    reasons.push({
      code: 'CROSS_CHECK_UNCORROBORATED',
      detail: `${uncorroborated} field(s) have only a single source`,
    });
  }

  const potentialAml =
    input.entityAmlRisk === 'potential_match' ||
    input.keyPeople.some((p) => p.aml_risk_level === 'potential_match');
  if (opts.pepRoutesToReview && potentialAml) {
    reasons.push({ code: 'AML_POTENTIAL_MATCH', detail: 'PEP or adverse-media signal requires analyst review' });
  }

  const tampered = input.documents.filter((d) => d.tamper_check_passed === false);
  if (tampered.length > 0) {
    reasons.push({
      code: 'DOCUMENT_TAMPER',
      detail: `Tamper signal on: ${tampered.map((d) => d.document_type).join(', ')}`,
    });
  }

  // Nested KYB. An unresolved corporate owner means we cannot say who
  // ultimately owns this company - which is the whole question UBO discovery
  // exists to answer. Approving here would be approving an unknown.
  if (opts.resolveNestedOwnership && graph) {
    if (graph.structural_warning) {
      reasons.push({ code: 'OWNERSHIP_STRUCTURE_UNRESOLVABLE', detail: graph.structural_warning });
    }
    if (!graph.resolved) {
      const names = graph.unresolved_owners.map((u) => u.name).join(', ');
      reasons.push({
        code: 'OWNERSHIP_CHAIN_OPAQUE',
        detail:
          `${graph.opaque_percentage}% of ownership sits behind unresolved corporate owner(s): ${names}. ` +
          'Their own owners must be verified before the ultimate beneficial owners are known.',
      });
    }
  }

  if (opts.requireOwnershipReconciliation && !reconciles) {
    reasons.push({
      code: 'OWNERSHIP_UNRECONCILED',
      detail:
        ownership === null
          ? 'No ownership percentages declared'
          : `Declared ownership totals ${ownership}%, expected 100%`,
    });
  }

  if (reasons.length > 0) {
    return {
      status: 'IN_REVIEW',
      reasons,
      ubo_kyc_summary: summary,
      ownership_total: ownership,
      ownership_reconciles: reconciles,
      ...graphFields,
    };
  }

  // Clean. Auto-approve only if the workflow allows it; otherwise a human
  // still signs off, which some regulated customers require.
  return {
    status: opts.autoApproveWhenClean ? 'APPROVED' : 'IN_REVIEW',
    reasons: opts.autoApproveWhenClean
      ? [{ code: 'CLEAN', detail: 'All checks passed' }]
      : [{ code: 'MANUAL_SIGNOFF_REQUIRED', detail: 'Clean, but workflow requires manual approval' }],
    ubo_kyc_summary: summary,
    ownership_total: ownership,
    ownership_reconciles: reconciles,
    ...graphFields,
  };
}

/** Which people should get a child session spawned. */
export function peopleNeedingKyc(people: KeyPersonState[], policy: RolePolicy = {}): KeyPersonState[] {
  return people.filter(
    (p) => !p.is_corporate && personRequiresKyc(p.role_tags, policy) && !p.kyc_status,
  );
}

/** Which people should open a nested business session instead. */
export function peopleNeedingNestedKyb(people: KeyPersonState[]): KeyPersonState[] {
  return people.filter((p) => personRequiresNestedKyb(p.role_tags) || p.is_corporate === true);
}

export { CHILD_RESOLVED };
