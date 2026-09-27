import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { createTimelineActivity, Response } from 'twenty-sdk/logic-function';
import {
  API_QUOTE_CREATE,
  INSURANCE_QUOTE,
  TIMELINE_QUOTE_ISSUED,
} from 'src/constants/universal-identifiers';
import { errorResponse, jsonResponse, num, parseJsonBody, publicBaseUrl, str } from 'src/lib/http';
import { pricingFromEnv } from 'src/lib/pricing';
import { CoreDbClient } from 'src/lib/records';
import { createQuote } from 'src/lib/service-quotes';

const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const body = parseJsonBody(event);
    const db = new CoreDbClient();
    const result = await createQuote(
      db,
      {
        phone: str(body.phone),
        name: str(body.name) || undefined,
        plate: str(body.plate),
        vehicleValue: num(body.vehicleValue),
        make: str(body.make) || undefined,
        model: str(body.model) || undefined,
        year: body.year ? num(body.year) : undefined,
        channel: 'PORTAL',
      },
      { pricing: pricingFromEnv(), baseUrl: publicBaseUrl() },
    );
    try {
      await createTimelineActivity({
        timelineActivityTypeUniversalIdentifier: TIMELINE_QUOTE_ISSUED,
        targetObjectUniversalIdentifier: INSURANCE_QUOTE,
        targetRecordId: String(result.quote.id),
        properties: {
          reference: result.quote.reference,
          premium: result.quote.premium,
          channel: 'PORTAL',
        },
      });
    } catch (error) {
      console.error('quote timeline failed', error);
    }
    return jsonResponse({ ok: true, quote: result.quote }, 201);
  } catch (error) {
    return errorResponse(error);
  }
};

export default defineLogicFunction({
  universalIdentifier: API_QUOTE_CREATE,
  name: 'api-quote-create',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/api/quotes',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
});
