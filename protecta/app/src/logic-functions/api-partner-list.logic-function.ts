import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { API_PARTNER_LIST } from 'src/constants/universal-identifiers';
import { requirePartnerApiKey } from 'src/lib/auth-partner';
import { errorResponse, jsonResponse } from 'src/lib/http';
import { publicPartner } from 'src/lib/service-partners';
import { CoreDbClient } from 'src/lib/records';

const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const auth = await requirePartnerApiKey(new CoreDbClient(), event.headers);
    if (!auth.ok) {
      return jsonResponse(
        { ok: false, error: 'Invalid or missing API key.' },
        401,
      );
    }
    return jsonResponse({
      ok: true,
      partner: publicPartner(auth.partner),
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export default defineLogicFunction({
  universalIdentifier: API_PARTNER_LIST,
  name: 'api-partner-me',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/api/partners/me',
    httpMethod: 'GET',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-api-key', 'authorization'],
  },
});
