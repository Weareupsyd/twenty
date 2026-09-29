import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensurePolicyCommission: vi.fn(async () => ({ id: 'commission-1' })),
  findFirst: vi.fn(async (..._args: unknown[]) => ({
    id: 'policy-refetched',
    premiumUgx: 100_000,
    agentId: 'agent-1',
  })),
}));

vi.mock('src/lib/records', () => ({
  CoreDbClient: class {
    findFirst(...args: unknown[]) {
      return mocks.findFirst(...args);
    }
  },
}));
vi.mock('src/lib/service-policies', () => ({
  ensurePolicyCommission: mocks.ensurePolicyCommission,
}));

import createOnCreate, {
  handler as createHandler,
} from 'src/logic-functions/create-policy-commission.logic-function';
import createOnUpdate, {
  handler as updateHandler,
} from 'src/logic-functions/create-policy-commission-on-update.logic-function';

type LogicConfig = {
  config: {
    databaseEventTriggerSettings?: { eventName: string };
  };
};

const configOf = (value: unknown) => (value as LogicConfig).config;

describe('automatic policy commissions', () => {
  it('runs when a policy is created', async () => {
    const eventRecord = { id: 'policy-1' };
    const policy = { id: 'policy-1', premiumUgx: 150_000, agentId: 'agent-1' };
    mocks.findFirst.mockResolvedValueOnce(policy);
    await createHandler({ properties: { after: eventRecord } } as never);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      'insurancePolicies',
      { id: { eq: 'policy-1' } },
      ['policyNo', 'premiumUgx', 'agentId'],
    );
    expect(mocks.ensurePolicyCommission).toHaveBeenCalledWith(
      expect.any(Object),
      policy,
    );
    expect(configOf(createOnCreate).databaseEventTriggerSettings).toEqual({
      eventName: 'insurancePolicy.created',
    });
  });

  it('runs when agent details are attached to a policy later', async () => {
    const eventRecord = { id: 'policy-2' };
    const policy = { id: 'policy-2', premiumUgx: 125_000, agentId: 'agent-2' };
    mocks.findFirst.mockResolvedValueOnce(policy);
    await updateHandler({ properties: { after: eventRecord } } as never);
    expect(mocks.ensurePolicyCommission).toHaveBeenLastCalledWith(
      expect.any(Object),
      policy,
    );
    expect(configOf(createOnUpdate).databaseEventTriggerSettings).toEqual({
      eventName: 'insurancePolicy.updated',
    });
  });
});
