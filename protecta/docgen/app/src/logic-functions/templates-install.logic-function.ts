import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { TEMPLATES_INSTALL } from 'src/constants/universal-identifiers';
import { jsonResponse, parseJsonBody, str } from 'src/lib/http';
import {
  POLICY_TEMPLATE_NAME,
  POLICY_TEMPLATE_NOTES,
} from 'src/lib/policy-template';
import { POLICY_TEMPLATE_HTML } from 'src/lib/policy-template-html';
import { CoreDbClient } from 'src/lib/records';
import { DEFAULT_DOCUMENT_KIND } from 'src/lib/service-documents';

/**
 * Put the built-in policy template into the workspace, as a "Document
 * template" record, so staff can read and edit the wording in the CRM.
 *
 *   POST /docgen/templates/install                  create it if missing
 *   POST /docgen/templates/install?force=1          restore the built-in body
 *                                                   (discards local edits)
 *   POST /docgen/templates/install  { kind, name }  install under another kind
 *
 * Without a record the generator already uses the built-in body; this route
 * exists so the wording is visible and editable in the CRM.
 */
const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const body = parseJsonBody(event);
    const query = event.queryStringParameters ?? {};
    const force = (str(body.force) || str(query.force)) === '1' ||
      str(body.force) === 'true';
    const kind =
      (str(body.kind) || str(query.kind) || DEFAULT_DOCUMENT_KIND).trim();
    const name = (str(body.name) || str(query.name) || POLICY_TEMPLATE_NAME).trim();
    const db = new CoreDbClient();

    const existing = await db.findFirst(
      'documentTemplates',
      { kind: { eq: kind } },
      ['id', 'name', 'kind', 'body'],
    );

    if (existing) {
      const hasBody =
        typeof existing.body === 'string' && existing.body.trim().length > 0;
      if (hasBody && !force) {
        return jsonResponse({
          ok: true,
          action: 'exists',
          id: String(existing.id),
          kind,
          name: String(existing.name ?? ''),
          characters: String(existing.body).length,
          note:
            'This workspace already has a template for this kind; the generator uses it. Pass force=1 to restore the built-in policy document.',
        });
      }
      const updated = await db.update('documentTemplate', String(existing.id), {
        name,
        body: POLICY_TEMPLATE_HTML,
        format: 'HTML',
        notes: POLICY_TEMPLATE_NOTES,
      });
      return jsonResponse({
        ok: true,
        action: 'updated',
        id: String(updated.id ?? existing.id),
        kind,
        name,
        characters: POLICY_TEMPLATE_HTML.length,
      });
    }

    const created = await db.create('documentTemplate', {
      name,
      kind,
      format: 'HTML',
      body: POLICY_TEMPLATE_HTML,
      notes: POLICY_TEMPLATE_NOTES,
    });
    return jsonResponse(
      {
        ok: true,
        action: 'created',
        id: String(created.id),
        kind,
        name,
        characters: POLICY_TEMPLATE_HTML.length,
      },
      201,
    );
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'Failed.' },
      400,
    );
  }
};

export default defineLogicFunction({
  universalIdentifier: TEMPLATES_INSTALL,
  name: 'templates-install',
  description:
    'Installs the built-in policy template into the workspace as an editable Document template record.',
  timeoutSeconds: 60,
  handler,
  httpRouteTriggerSettings: {
    path: '/docgen/templates/install',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
});
