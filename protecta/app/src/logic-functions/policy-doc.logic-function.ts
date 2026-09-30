import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { POLICY_DOC } from 'src/constants/universal-identifiers';
import { htmlResponse } from 'src/lib/http';
import { renderErrorPage, renderPolicyPage } from 'src/lib/pages';
import { CoreDbClient } from 'src/lib/records';
import { findPolicyByNo } from 'src/lib/service-policies';
import { findQuoteByRef } from 'src/lib/service-quotes';

const handler = async (event: RoutePayload): Promise<Response> => {
  const ref = (event.queryStringParameters?.ref ?? '').trim().toUpperCase();
  if (!ref) {
    return htmlResponse(renderErrorPage('Missing reference', 'Provide ?ref=<policyNo>.'), 400);
  }
  const db = new CoreDbClient();
  let policy = await findPolicyByNo(db, ref);
  if (!policy) {
    const quote = await findQuoteByRef(db, ref);
    if (quote) {
      policy = await db.findFirst(
        'insurancePolicies',
        { quoteRef: { eq: String(quote.reference) } },
        [
          'policyNo',
          'status',
          'plate',
          'vehicleMake',
          'vehicleModel',
          'premiumUgx',
          'periodStart',
          'periodEnd',
        ],
      );
    }
  }
  if (!policy) {
    return htmlResponse(
      renderErrorPage('Policy not found', `No policy with number ${ref}.`),
      404,
    );
  }
  return htmlResponse(renderPolicyPage(policy));
};

export default defineLogicFunction({
  universalIdentifier: POLICY_DOC,
  name: 'policy-doc',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/policies/doc',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
