import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoutePayload } from 'twenty-sdk/define';

// Every CoreDbClient the route creates talks to one in-memory workspace,
// so the route can be exercised end to end without a server.
vi.mock('src/lib/records', async (importOriginal) => {
  const actual = await importOriginal<typeof import('src/lib/records')>();
  const shared = new actual.MemoryDbClient();
  class FakeCoreDbClient {
    static shared = shared;
    findFirst(
      ...args: Parameters<typeof shared.findFirst>
    ): ReturnType<typeof shared.findFirst> {
      return shared.findFirst(...args);
    }
    findMany(
      ...args: Parameters<typeof shared.findMany>
    ): ReturnType<typeof shared.findMany> {
      return shared.findMany(...args);
    }
    create(
      ...args: Parameters<typeof shared.create>
    ): ReturnType<typeof shared.create> {
      return shared.create(...args);
    }
    update(
      ...args: Parameters<typeof shared.update>
    ): ReturnType<typeof shared.update> {
      return shared.update(...args);
    }
  }
  return { ...actual, CoreDbClient: FakeCoreDbClient };
});

import { CoreDbClient } from 'src/lib/records';
import { POLICY_TEMPLATE_NAME } from 'src/lib/policy-template';
import { POLICY_TEMPLATE_HTML } from 'src/lib/policy-template-html';
import templatesInstall from 'src/logic-functions/templates-install.logic-function';

type RouteHandler = (
  payload: RoutePayload,
) => Promise<{ body: unknown; status?: number }>;
const handle = templatesInstall.config.handler as unknown as RouteHandler;
const workspace = (
  CoreDbClient as unknown as {
    shared: { store: Record<string, Record<string, unknown>[]> };
  }
).shared;

const event = (
  body: Record<string, unknown> = {},
  query: Record<string, string> = {},
): RoutePayload =>
  ({ body, queryStringParameters: query }) as unknown as RoutePayload;

// The logic-function Response is a plain carrier: the JSON string is in .body.
const payloadOf = (response: {
  body: unknown;
}): Record<string, unknown> =>
  JSON.parse(String(response.body)) as Record<string, unknown>;

describe('templates-install route', () => {
  beforeEach(() => {
    workspace.store.documentTemplates = [];
    workspace.store.generatedDocuments = [];
  });

  it('installs the built-in policy template into the workspace', async () => {
    const response = await handle(event());
    expect(response.status).toBe(201);
    expect(payloadOf(response)).toMatchObject({
      ok: true,
      action: 'created',
      name: POLICY_TEMPLATE_NAME,
      characters: POLICY_TEMPLATE_HTML.length,
    });
    const stored = workspace.store.documentTemplates[0];
    expect(stored.kind).toBe('POLICY_CERTIFICATE');
    expect(stored.format).toBe('HTML');
    expect(String(stored.body)).toContain('MOTOR PROTECTA BODE');
    expect(String(stored.body)).toContain('POLICY SCHEDULE');
    expect(String(stored.body)).toContain('{{policyNo}}');
    expect(String(stored.body)).toContain('{{policyholderName}}');
    expect(String(stored.body)).not.toContain('image001.png');
  });

  it('keeps a template that is already there, edits and all', async () => {
    await handle(event());
    workspace.store.documentTemplates[0].body = 'OUR OWN WORDING {{policyNo}}';

    const response = await handle(event());
    expect(response.status).toBe(200);
    expect(payloadOf(response)).toMatchObject({ action: 'exists' });
    expect(String(workspace.store.documentTemplates[0].body)).toBe(
      'OUR OWN WORDING {{policyNo}}',
    );
  });

  it('restores the built-in body when forced', async () => {
    await handle(event());
    workspace.store.documentTemplates[0].body = 'OUR OWN WORDING';

    const response = await handle(event({ force: '1' }));
    expect(payloadOf(response)).toMatchObject({ action: 'updated' });
    expect(String(workspace.store.documentTemplates[0].body)).toBe(
      POLICY_TEMPLATE_HTML,
    );
  });

  it('accepts kind and name overrides', async () => {
    const response = await handle(
      event({ kind: 'COVER_NOTE', name: 'Cover note' }),
    );
    expect(payloadOf(response)).toMatchObject({
      action: 'created',
      kind: 'COVER_NOTE',
      name: 'Cover note',
    });
    expect(workspace.store.documentTemplates[0].kind).toBe('COVER_NOTE');
  });

  it('reports a failure instead of throwing', async () => {
    const prototype = CoreDbClient.prototype as unknown as {
      findFirst: unknown;
    };
    const original = prototype.findFirst;
    prototype.findFirst = () => Promise.reject(new Error('permission denied'));
    const response = await handle(event());
    prototype.findFirst = original;
    expect(response.status).toBe(400);
    expect(payloadOf(response)).toMatchObject({
      ok: false,
      error: 'permission denied',
    });
  });
});
