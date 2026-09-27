import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { API_PARTNER_EVENTS } from 'src/constants/universal-identifiers';
import { requirePartnerApiKey } from 'src/lib/auth-partner';
import { errorResponse, jsonResponse } from 'src/lib/http';
import { CoreDbClient } from 'src/lib/records';
import { listEventsForPartner } from 'src/lib/service-partners';

const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const auth = await requirePartnerApiKey(new CoreDbClient(), event.headers);
    if (!auth.ok) {
      return jsonResponse({ ok: false, error: 'Invalid or missing API key.' }, 401);
    }
    const q = event.queryStringParameters ?? {};
    const events = await listEventsForPartner(
      auth.partner,
      String(auth.partner.partnerCode),
      {
        type: q.type ? String(q.type) : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
        before: q.before ? String(q.before) : undefined,
      },
    );
    return jsonResponse({ ok: true, events });
  } catch (error) {
    return errorResponse(error);
  }
};

export default defineLogicFunction({
  universalIdentifier: API_PARTNER_EVENTS,
  name: 'api-partner-events',
  timeoutSeconds: 20,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/api/partners/events',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
