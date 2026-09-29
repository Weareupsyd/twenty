import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { getPublicAssetUrl } from 'twenty-sdk/utils';
import { TERMS_PAGE } from 'src/constants/universal-identifiers';
import { browserAssetUrl } from 'src/lib/browser-asset-url';
import { htmlResponse } from 'src/lib/http';
import { renderTermsPage } from 'src/lib/terms-page';

const handler = async (_event: RoutePayload): Promise<Response> =>
  htmlResponse(
    renderTermsPage({
      logoUrl: browserAssetUrl(getPublicAssetUrl('brand/assets/protecta-bode-logo.png')),
      supportPhone: (process.env.SUPPORT_PHONE ?? '+256312246500').replace('+256', '0'),
    }),
  );

export default defineLogicFunction({
  universalIdentifier: TERMS_PAGE,
  name: 'terms',
  description: 'Public Protecta Bode Terms and Conditions page.',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/terms',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
