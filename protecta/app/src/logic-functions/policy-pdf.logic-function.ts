import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { POLICY_PDF } from 'src/constants/universal-identifiers';
import { htmlResponse } from 'src/lib/http';
import { renderErrorPage, renderPolicyPage } from 'src/lib/pages';
import { CoreDbClient } from 'src/lib/records';
import { findPolicyByNo } from 'src/lib/service-policies';
import { findQuoteByRef } from 'src/lib/service-quotes';

/**
 * Legacy URL kept for existing customer bookmarks. It now opens the same
 * full-policy landing page instead of generating the old one-page certificate.
 */
const handler = async (event: RoutePayload): Promise<Response> => {
  const ref = (event.queryStringParameters?.ref ?? '').trim().toUpperCase();
  const id = (event.queryStringParameters?.id ?? '').trim();
  if (!ref && !id) {
    return htmlResponse(
      renderErrorPage('Missing reference', 'Provide ?ref=<policyNo>.'),
      400,
    );
  }

  const db = new CoreDbClient();
  let policy = id
    ? await db.findFirst('insurancePolicies', { id: { eq: id } }, [
        'policyNo',
        'status',
        'plate',
        'vehicleMake',
        'vehicleModel',
        'premiumUgx',
        'periodStart',
        'periodEnd',
      ])
    : await findPolicyByNo(db, ref);

  if (!policy && ref) {
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
      renderErrorPage(
        'Policy not found',
        `No policy with number ${ref || id}. If you just converted a quote, try again in a moment.`,
      ),
      404,
    );
  }

  return htmlResponse(renderPolicyPage(policy));
};

export default defineLogicFunction({
  universalIdentifier: POLICY_PDF,
  name: 'policy-pdf',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/policies/pdf',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
