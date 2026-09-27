/**
 * Per-workflow settings resolution.
 *
 * The layering is call override > workflow setting > deployment default, and
 * the whole point is that two workflows on one deployment can behave
 * differently. The cases below are the ones that would silently produce wrong
 * verdicts if the precedence or the null handling were wrong.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/config/database.js', () => ({ supabase: {} }));
vi.mock('@/utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { resolveSettings, deploymentNestedDefault } = await import('../workflowSettings.js');
type Workflow = Parameters<typeof resolveSettings>[0];

const workflow = (over: Partial<NonNullable<Workflow>> = {}): NonNullable<Workflow> => ({
  id: 'w1',
  developer_id: 'dev-1',
  workflow_id: 'standard',
  name: null,
  description: null,
  nested_ownership_enabled: null,
  auto_approve_when_clean: null,
  required_documents: null,
  ubo_threshold_percentage: null,
  is_active: true,
  ...over,
});

const originalEnv = process.env.KYB_NESTED_OWNERSHIP;
afterEach(() => {
  if (originalEnv === undefined) delete process.env.KYB_NESTED_OWNERSHIP;
  else process.env.KYB_NESTED_OWNERSHIP = originalEnv;
});

describe('deployment default', () => {
  it('is off unless the env says otherwise', () => {
    delete process.env.KYB_NESTED_OWNERSHIP;
    expect(deploymentNestedDefault()).toBe(false);
  });

  it('is on only for the exact string "true"', () => {
    process.env.KYB_NESTED_OWNERSHIP = 'true';
    expect(deploymentNestedDefault()).toBe(true);
    // "1", "yes" and "TRUE" are not accepted - a half-recognised value that
    // silently means "off" is worse than one that obviously does.
    for (const v of ['1', 'yes', 'TRUE', 'on']) {
      process.env.KYB_NESTED_OWNERSHIP = v;
      expect(deploymentNestedDefault()).toBe(false);
    }
  });
});

describe('inheritance', () => {
  beforeEach(() => { delete process.env.KYB_NESTED_OWNERSHIP; });

  it('falls back to the deployment default when no workflow is registered', () => {
    const s = resolveSettings(null);
    expect(s.nestedOwnershipEnabled).toBe(false);
    expect(s.source.nestedOwnership).toBe('deployment');
  });

  it('inherits when the workflow has no opinion (null)', () => {
    process.env.KYB_NESTED_OWNERSHIP = 'true';
    const s = resolveSettings(workflow({ nested_ownership_enabled: null }));
    expect(s.nestedOwnershipEnabled).toBe(true);
    expect(s.source.nestedOwnership).toBe('deployment');
  });

  it('lets a workflow switch it ON while the deployment default is off', () => {
    delete process.env.KYB_NESTED_OWNERSHIP;
    const s = resolveSettings(workflow({ nested_ownership_enabled: true }));
    expect(s.nestedOwnershipEnabled).toBe(true);
    expect(s.source.nestedOwnership).toBe('workflow');
  });

  it('lets a workflow switch it OFF while the deployment default is on', () => {
    // The important half: false must not be mistaken for "unset" and
    // overwritten by the default. This is the classic `??` vs `||` bug.
    process.env.KYB_NESTED_OWNERSHIP = 'true';
    const s = resolveSettings(workflow({ nested_ownership_enabled: false }));
    expect(s.nestedOwnershipEnabled).toBe(false);
    expect(s.source.nestedOwnership).toBe('workflow');
  });
});

describe('call-level override', () => {
  beforeEach(() => { delete process.env.KYB_NESTED_OWNERSHIP; });

  it('beats a workflow that says off', () => {
    const s = resolveSettings(workflow({ nested_ownership_enabled: false }), {
      resolveNestedOwnership: true,
    });
    expect(s.nestedOwnershipEnabled).toBe(true);
    expect(s.source.nestedOwnership).toBe('call');
  });

  it('beats a workflow that says on', () => {
    const s = resolveSettings(workflow({ nested_ownership_enabled: true }), {
      resolveNestedOwnership: false,
    });
    expect(s.nestedOwnershipEnabled).toBe(false);
    expect(s.source.nestedOwnership).toBe('call');
  });

  it('an undefined override defers instead of forcing false', () => {
    const s = resolveSettings(workflow({ nested_ownership_enabled: true }), {
      resolveNestedOwnership: undefined,
    });
    expect(s.nestedOwnershipEnabled).toBe(true);
    expect(s.source.nestedOwnership).toBe('workflow');
  });
});

describe('two workflows, one deployment', () => {
  it('resolve independently - the whole point of the table', () => {
    delete process.env.KYB_NESTED_OWNERSHIP;
    const strict = resolveSettings(workflow({ workflow_id: 'strict', nested_ownership_enabled: true }));
    const light = resolveSettings(workflow({ workflow_id: 'light', nested_ownership_enabled: false }));
    const inherit = resolveSettings(workflow({ workflow_id: 'inherit' }));

    expect(strict.nestedOwnershipEnabled).toBe(true);
    expect(light.nestedOwnershipEnabled).toBe(false);
    expect(inherit.nestedOwnershipEnabled).toBe(false);
  });
});

describe('required documents', () => {
  it('inherits when null', () => {
    expect(resolveSettings(workflow({ required_documents: null })).requiredDocuments).toBeUndefined();
  });

  it('treats an EMPTY array as a real setting, not as unset', () => {
    // `|| undefined` here would silently reimpose the default document list on
    // a workflow that deliberately requires none.
    const s = resolveSettings(workflow({ required_documents: [] }));
    expect(s.requiredDocuments).toEqual([]);
  });

  it('passes a specific list through', () => {
    const s = resolveSettings(workflow({ required_documents: ['certificate_of_incorporation'] }));
    expect(s.requiredDocuments).toEqual(['certificate_of_incorporation']);
  });

  it('lets the call override the workflow', () => {
    const s = resolveSettings(workflow({ required_documents: ['a'] }), { requiredDocuments: ['b'] });
    expect(s.requiredDocuments).toEqual(['b']);
  });
});

describe('UBO threshold', () => {
  it('is undefined when unset, so the FATF default applies', () => {
    expect(resolveSettings(workflow()).uboThresholdPercentage).toBeUndefined();
  });

  it('coerces the string Postgres NUMERIC returns', () => {
    // NUMERIC comes back as a string through pg; a threshold compared as a
    // string would misjudge ownership.
    const s = resolveSettings(workflow({ ubo_threshold_percentage: '10.00' }));
    expect(s.uboThresholdPercentage).toBe(10);
    expect(typeof s.uboThresholdPercentage).toBe('number');
  });

  it('accepts a plain number', () => {
    expect(resolveSettings(workflow({ ubo_threshold_percentage: 25 })).uboThresholdPercentage).toBe(25);
  });

  it('ignores an unparseable value rather than yielding NaN', () => {
    expect(resolveSettings(workflow({ ubo_threshold_percentage: 'not a number' })).uboThresholdPercentage)
      .toBeUndefined();
  });
});

describe('auto-approve', () => {
  it('inherits when null', () => {
    expect(resolveSettings(workflow()).autoApproveWhenClean).toBeUndefined();
  });

  it('keeps an explicit false distinct from unset', () => {
    expect(resolveSettings(workflow({ auto_approve_when_clean: false })).autoApproveWhenClean).toBe(false);
  });

  it('lets the call override', () => {
    expect(resolveSettings(workflow({ auto_approve_when_clean: false }), { autoApprove: true })
      .autoApproveWhenClean).toBe(true);
  });
});
