import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { API_PARTNER_REGISTER } from 'src/constants/universal-identifiers';
import { errorResponse, jsonResponse, parseJsonBody, str } from 'src/lib/http';
import { CoreDbClient } from 'src/lib/records';
import { registerPartner } from 'src/lib/service-partners';

const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const body = parseJsonBody(event);
    const db = new CoreDbClient();
    const { partner, apiKey } = await registerPartner(db, {
      type: str(body.type) || 'AGENT',
      name: str(body.name),
      email: str(body.email) || undefined,
      phone: str(body.phone) || undefined,
      companyId: str(body.companyId) || undefined,
      commissionRate: body.commissionRate !== undefined ? Number(body.commissionRate) : undefined,
    });
    // The plaintext key is returned exactly once; only its hash is stored.
    return jsonResponse({ ok: true, partner, apiKey }, 201);
  } catch (error) {
    return errorResponse(error);
  }
};

export default defineLogicFunction({
  universalIdentifier: API_PARTNER_REGISTER,
  name: 'api-partner-register',
  timeoutSeconds: 20,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/api/partners',
    httpMethod: 'POST',
    isAuthRequired: true,
  },
});
