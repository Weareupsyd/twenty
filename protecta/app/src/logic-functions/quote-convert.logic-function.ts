import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { QUOTE_CONVERT } from 'src/constants/universal-identifiers';
import { errorResponse, jsonResponse, parseJsonBody, str } from 'src/lib/http';
import { CoreDbClient } from 'src/lib/records';
import { findQuoteByRef } from 'src/lib/service-quotes';
import { issuePolicy } from 'src/lib/service-policies';

const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const body = parseJsonBody(event);
    const quoteRef = str(body.quoteRef || body.reference || event.queryStringParameters?.ref || '').trim().toUpperCase();
    if (!quoteRef) {
      return jsonResponse({ ok: false, error: 'quoteRef is required.' }, 400);
    }
    const db = new CoreDbClient();
    const quote = await findQuoteByRef(db, quoteRef);
    if (!quote) {
      return jsonResponse({ ok: false, error: `Quote ${quoteRef} not found.` }, 404);
    }
    if (quote.status === 'EXPIRED') {
      return jsonResponse({ ok: false, error: 'Quote has expired.' }, 400);
    }
    if (quote.status === 'ACCEPTED') {
      // Already converted – return existing policy
      const existing = await db.findFirst('insurancePolicies', { quoteRef: { eq: quoteRef } }, ['policyNo', 'status', 'plate', 'premiumUgx']);
      return jsonResponse({ ok: true, alreadyConverted: true, quote, policy: existing });
    }
    // Issue policy directly (staff conversion – no payment check). Mirrors payment-confirm path but without payment.
    const { policy } = await issuePolicy(db, { quoteRef });
    return jsonResponse({ ok: true, quote, policy }, 201);
  } catch (error) {
    return errorResponse(error);
  }
};

export default defineLogicFunction({
  universalIdentifier: QUOTE_CONVERT,
  name: 'quote-convert',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/quotes/convert',
    httpMethod: 'POST',
    isAuthRequired: true,
  },
});
