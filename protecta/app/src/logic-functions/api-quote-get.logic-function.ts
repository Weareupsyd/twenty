import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { API_QUOTE_GET } from 'src/constants/universal-identifiers';
import { errorResponse, jsonResponse } from 'src/lib/http';
import { CoreDbClient } from 'src/lib/records';
import { findQuoteByRef } from 'src/lib/service-quotes';

const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const ref = (event.queryStringParameters?.ref ?? '').trim();
    if (!ref) {
      return jsonResponse({ ok: false, error: 'Missing ?ref= quote reference.' }, 400);
    }
    const quote = await findQuoteByRef(new CoreDbClient(), ref);
    if (!quote) {
      return jsonResponse({ ok: false, error: 'Quote not found.' }, 404);
    }
    return jsonResponse({ ok: true, quote });
  } catch (error) {
    return errorResponse(error);
  }
};

export default defineLogicFunction({
  universalIdentifier: API_QUOTE_GET,
  name: 'api-quote-get',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/api/quotes/get',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
