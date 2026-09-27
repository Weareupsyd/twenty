import { afterEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({
  client: vi.fn(),
  run: vi.fn(async () => ({ status: 'APPROVED' })),
}));
vi.mock('src/lib/records', () => ({
  CoreDbClient: class {
    constructor(options: unknown) {
      mocked.client(options);
    }
  },
}));
vi.mock('src/lib/staff-actions', () => ({ runStaffAction: mocked.run }));
import { handler } from 'src/logic-functions/staff-action.logic-function';
import { routeEvent } from 'src/test-utils/route-event';
afterEach(() => vi.clearAllMocks());
describe('staff route', () => {
  it('runs staff operations with caller permissions, never application privileges', async () => {
    const result = await handler(
      routeEvent({
        body: {
          action: 'kyc-approve',
          id: '20202020-1c25-4d02-bf25-6aeccf7ea419',
        },
      }),
    );
    expect(result.status).toBe(200);
    expect(mocked.client).toHaveBeenCalledWith({ runAs: 'user' });
  });
  it('rejects missing record IDs without touching records', async () => {
    expect(
      (await handler(routeEvent({ body: { action: 'kyc-approve' } }))).status,
    ).toBe(400);
    expect(mocked.run).not.toHaveBeenCalled();
  });
});
