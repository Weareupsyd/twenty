import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { CLAIM_VIEW } from 'src/constants/universal-identifiers';
import { htmlResponse } from 'src/lib/http';
import { renderClaimPage, renderErrorPage } from 'src/lib/pages';
import { CoreDbClient } from 'src/lib/records';
import { findClaimByRef } from 'src/lib/service-claims';

const handler = async (event: RoutePayload): Promise<Response> => {
  const ref = (event.queryStringParameters?.ref ?? '').trim().toUpperCase();
  if (!ref) {
    return htmlResponse(renderErrorPage('Missing reference', 'Provide ?ref=<claimRef>.'), 400);
  }
  const claim = await findClaimByRef(new CoreDbClient(), ref);
  if (!claim) {
    return htmlResponse(
      renderErrorPage('Claim not found', `No claim with reference ${ref}.`),
      404,
    );
  }
  return htmlResponse(renderClaimPage(claim));
};

export default defineLogicFunction({
  universalIdentifier: CLAIM_VIEW,
  name: 'claim-view',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/claims/view',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
