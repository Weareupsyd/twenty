import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { QUOTE_PDF } from 'src/constants/universal-identifiers';
import { htmlResponse, publicBaseUrl } from 'src/lib/http';
import { renderErrorPage } from 'src/lib/pages';
import { CoreDbClient } from 'src/lib/records';
import { generateQuotePdf, quotePdfFileName } from 'src/lib/quote-pdf';
import { findPersonByPhone, findQuoteByRef, personDisplayName } from 'src/lib/service-quotes';

const handler = async (event: RoutePayload): Promise<Response> => {
  const ref = (event.queryStringParameters?.ref ?? '').trim();
  if (!ref) {
    return htmlResponse(
      renderErrorPage('Missing reference', 'Provide ?ref=<quoteRef>.'),
      400,
    );
  }
  const db = new CoreDbClient();
  const quote = await findQuoteByRef(db, ref);
  if (!quote) {
    return htmlResponse(
      renderErrorPage('Quote not found', `No quote with reference ${ref}.`),
      404,
    );
  }
  const person = await findPersonByPhone(
    db,
    String(quote.policyholderPhone ?? ''),
  );
  const pdf = await generateQuotePdf(quote, {
    ...(person ? { name: personDisplayName(person) } : {}),
    baseUrl: publicBaseUrl(),
  });
  return new Response(pdf as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${quotePdfFileName(quote)}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
};

export default defineLogicFunction({
  universalIdentifier: QUOTE_PDF,
  name: 'quote-pdf',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/quotes/pdf',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
