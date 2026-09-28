import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { createTimelineActivity, Response } from 'twenty-sdk/logic-function';
import {
  API_QUOTE_CREATE,
  INSURANCE_QUOTE,
  TIMELINE_QUOTE_ISSUED,
} from 'src/constants/universal-identifiers';
import {
  errorResponse,
  jsonResponse,
  num,
  parseJsonBody,
  publicBaseUrl,
  str,
} from 'src/lib/http';
import { pricingFromEnv } from 'src/lib/pricing';
import { CoreDbClient } from 'src/lib/records';
import { createQuote } from 'src/lib/service-quotes';

import { headerValue, requirePartnerApiKey } from 'src/lib/auth-partner';
import { appendPartnerQuote, setQuotePartner } from 'src/lib/attribution';
import { fanoutPartnerEvent } from 'src/lib/fanout';
import { hasScope } from 'src/lib/partner-scopes';
import { type RecordData } from 'src/lib/records';

const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const body = parseJsonBody(event);
    const db = new CoreDbClient();
    let partner: RecordData | null = null;
    if (
      headerValue(event.headers, 'x-api-key') ||
      headerValue(event.headers, 'authorization')
    ) {
      const auth = await requirePartnerApiKey(db, event.headers);
      if (!auth.ok)
        return jsonResponse(
          { ok: false, error: 'Invalid partner credentials.' },
          401,
        );
      if (!hasScope(auth.partner.scopes as string[], 'quotes:write'))
        return jsonResponse(
          { ok: false, error: 'Missing quotes:write scope.' },
          403,
        );
      partner = auth.partner;
    }
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
        channel: partner ? 'PARTNER_API' : 'PORTAL',
        email: str(body.email) || undefined,
        nin: str(body.idNo) || str(body.nin) || undefined,
        consent: body.consent === true,
      },
      { pricing: pricingFromEnv(), baseUrl: publicBaseUrl() },
    );
    if (partner) {
      const reference = String(result.quote.reference);
      await setQuotePartner(reference, String(partner.id));
      await appendPartnerQuote(String(partner.id), reference);
      await fanoutPartnerEvent(db, 'quote.created', reference, {
        reference,
        premium: result.quote.premium,
      });
    }
    try {
      await createTimelineActivity({
        timelineActivityTypeUniversalIdentifier: TIMELINE_QUOTE_ISSUED,
        targetObjectUniversalIdentifier: INSURANCE_QUOTE,
        targetRecordId: String(result.quote.id),
        properties: {
          reference: result.quote.reference,
          premium: result.quote.premium,
          channel: partner ? 'PARTNER_API' : 'PORTAL',
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
    forwardedRequestHeaders: ['x-api-key', 'authorization'],
  },
});
