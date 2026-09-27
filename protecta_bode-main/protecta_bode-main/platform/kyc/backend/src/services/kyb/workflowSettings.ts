/**
 * Per-workflow KYB settings.
 *
 * Resolves what a given session should actually do, from three layers:
 *
 *   1. an explicit per-call override  (highest - tests, one-off reprocessing)
 *   2. the workflow's stored settings (the normal way to choose)
 *   3. the deployment default        (env, lowest)
 *
 * The layering exists so that turning nested ownership resolution on for one
 * workflow does not change any other workflow's verdicts, and so a caller can
 * still force either behaviour for a single call without touching stored
 * configuration.
 */

import { supabase } from '@/config/database.js';
import { logger } from '@/utils/logger.js';

/** A workflow row, as stored. NULL fields mean "inherit". */
export interface KybWorkflow {
  id: string;
  developer_id: string;
  workflow_id: string;
  name: string | null;
  description: string | null;
  nested_ownership_enabled: boolean | null;
  auto_approve_when_clean: boolean | null;
  required_documents: string[] | null;
  ubo_threshold_percentage: number | string | null;
  is_active: boolean;
}

/** Fully resolved settings - no nulls, every question answered. */
export interface ResolvedWorkflowSettings {
  nestedOwnershipEnabled: boolean;
  autoApproveWhenClean: boolean | undefined;
  requiredDocuments: string[] | undefined;
  uboThresholdPercentage: number | undefined;
  /** Where each decision came from, so the UI can show inherited vs set. */
  source: {
    nestedOwnership: 'call' | 'workflow' | 'deployment';
  };
}

/** Deployment-wide default; the floor of the layering. */
export function deploymentNestedDefault(): boolean {
  return process.env.KYB_NESTED_OWNERSHIP === 'true';
}

/**
 * Load a workflow's stored settings.
 *
 * Returns null when there is no row - which is the common case, not an error:
 * `workflow_id` is free text and most integrators never register one.
 */
export async function getWorkflow(
  developerId: string,
  workflowId: string | null | undefined,
): Promise<KybWorkflow | null> {
  if (!workflowId) return null;

  const { data, error } = await supabase
    .from('kyb_workflows')
    .select('*')
    .eq('developer_id', developerId)
    .eq('workflow_id', workflowId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    // A settings lookup must never take a verification down. Falling back to
    // deployment defaults is the safe, predictable outcome.
    logger.warn('KYB workflow lookup failed; falling back to deployment defaults', {
      developerId, workflowId, error: error.message,
    });
    return null;
  }
  return (data as KybWorkflow) ?? null;
}

/** Postgres NUMERIC arrives as a string through pg. */
function toNumber(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Collapse the three layers into one answer.
 *
 * `override` wins outright when defined; then the workflow's stored value if
 * it has an opinion (non-null); then the deployment default.
 */
export function resolveSettings(
  workflow: KybWorkflow | null,
  override?: { resolveNestedOwnership?: boolean; autoApprove?: boolean; requiredDocuments?: string[] },
): ResolvedWorkflowSettings {
  let nested: boolean;
  let nestedSource: ResolvedWorkflowSettings['source']['nestedOwnership'];

  if (override?.resolveNestedOwnership !== undefined) {
    nested = override.resolveNestedOwnership;
    nestedSource = 'call';
  } else if (workflow?.nested_ownership_enabled !== null && workflow?.nested_ownership_enabled !== undefined) {
    nested = workflow.nested_ownership_enabled;
    nestedSource = 'workflow';
  } else {
    nested = deploymentNestedDefault();
    nestedSource = 'deployment';
  }

  return {
    nestedOwnershipEnabled: nested,
    autoApproveWhenClean:
      override?.autoApprove ?? workflow?.auto_approve_when_clean ?? undefined,
    // `?? undefined` deliberately, not `|| undefined`: an empty array is a
    // real setting meaning "require no documents".
    requiredDocuments:
      override?.requiredDocuments ?? workflow?.required_documents ?? undefined,
    uboThresholdPercentage: toNumber(workflow?.ubo_threshold_percentage),
    source: { nestedOwnership: nestedSource },
  };
}

/**
 * The usual entry point: resolve settings for a session in one call.
 */
export async function settingsForSession(
  session: { developer_id: string; workflow_id?: string | null },
  override?: { resolveNestedOwnership?: boolean; autoApprove?: boolean; requiredDocuments?: string[] },
): Promise<ResolvedWorkflowSettings> {
  const workflow = await getWorkflow(session.developer_id, session.workflow_id);
  return resolveSettings(workflow, override);
}

/** Create or update a workflow's settings. */
export async function upsertWorkflow(
  developerId: string,
  workflowId: string,
  settings: Partial<Omit<KybWorkflow, 'id' | 'developer_id' | 'workflow_id'>>,
): Promise<KybWorkflow> {
  const { data, error } = await supabase
    .from('kyb_workflows')
    .upsert(
      {
        developer_id: developerId,
        workflow_id: workflowId,
        ...settings,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'developer_id,workflow_id' },
    )
    .select()
    .single();

  if (error) throw new Error(`Failed to save KYB workflow: ${error.message}`);
  return data as KybWorkflow;
}

/** List a developer's workflows. */
export async function listWorkflows(developerId: string): Promise<KybWorkflow[]> {
  const { data, error } = await supabase
    .from('kyb_workflows')
    .select('*')
    .eq('developer_id', developerId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to list KYB workflows: ${error.message}`);
  return (data as KybWorkflow[]) ?? [];
}
