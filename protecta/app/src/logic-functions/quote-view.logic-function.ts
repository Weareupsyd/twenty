import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { QUOTE_VIEW } from 'src/constants/universal-identifiers';
import { htmlResponse } from 'src/lib/http';
import { renderErrorPage, renderQuotePage } from 'src/lib/pages';
import { CoreDbClient } from 'src/lib/records';
import { findQuoteByRef } from 'src/lib/service-quotes';

const handler = async (event: RoutePayload): Promise<Response> => {
  const ref = (event.queryStringParameters?.ref ?? '').trim();
  if (!ref) {
    return htmlResponse(renderErrorPage('Missing reference', 'Provide ?ref=<quoteRef>.'), 400);
  }
  const quote = await findQuoteByRef(new CoreDbClient(), ref);
  if (!quote) {
    return htmlResponse(
      renderErrorPage('Quote not found', `No quote with reference ${ref}.`),
      404,
    );
  }
  return htmlResponse(renderQuotePage(quote, '/s/protecta/'));
};

export default defineLogicFunction({
  universalIdentifier: QUOTE_VIEW,
  name: 'quote-view',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/quotes/view',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
