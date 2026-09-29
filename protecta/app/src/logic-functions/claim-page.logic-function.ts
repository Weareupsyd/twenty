import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { getPublicAssetUrl } from 'twenty-sdk/utils';
import { CLAIM_PAGE } from 'src/constants/universal-identifiers';
import { browserAssetUrl } from 'src/lib/browser-asset-url';
import {
  PROTECTA_LOGO_ASSET,
  renderClaimFormPage,
} from 'src/lib/claim-page-template';
import { htmlResponse } from 'src/lib/http';

const handler = async (event: RoutePayload): Promise<Response> => {
  const policy = (event.queryStringParameters?.policy ?? '').trim();
  const logoUrl = browserAssetUrl(getPublicAssetUrl(PROTECTA_LOGO_ASSET));

  return htmlResponse(renderClaimFormPage({ logoUrl, policy }));
};

export default defineLogicFunction({
  universalIdentifier: CLAIM_PAGE,
  name: 'claim-page',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/claims/new',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
