import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { getPublicAssetUrl } from 'twenty-sdk/utils';
import { LANDING } from 'src/constants/universal-identifiers';
import { htmlResponse } from 'src/lib/http';
import { renderLandingPage } from 'src/lib/landing-template';

const handler = async (_event: RoutePayload): Promise<Response> => {
  const supportPhone = process.env.SUPPORT_PHONE ?? '+256312246500';
  const html = renderLandingPage(
    '/s/protecta',
    {
      logo: getPublicAssetUrl('brand/assets/protecta-bode-logo.png'),
      kvWebp720: getPublicAssetUrl('brand/assets/key-visual-720.webp'),
      kvWebp1080: getPublicAssetUrl('brand/assets/key-visual-1080.webp'),
      kvWebp1600: getPublicAssetUrl('brand/assets/key-visual-1600.webp'),
      kvJpg720: getPublicAssetUrl('brand/assets/key-visual-720.jpg'),
      kvJpg1080: getPublicAssetUrl('brand/assets/key-visual-1080.jpg'),
      kvJpg1600: getPublicAssetUrl('brand/assets/key-visual-1600.jpg'),
      mtn: getPublicAssetUrl('brand/mtn-new-logo.svg'),
      airtel: getPublicAssetUrl('brand/Airtel_Uganda-Logo.wine.svg'),
      stanbic: getPublicAssetUrl('brand/Stanbic_Bank.jpg'),
      wa: getPublicAssetUrl('brand/whatsapp-svgrepo-com.svg'),
      email: getPublicAssetUrl('brand/email-18-svgrepo-com.svg'),
    },
    supportPhone.replace('+256', '0'),
    `tel:${supportPhone.replace(/\s/g, '')}`,
  );
  return htmlResponse(html);
};

export default defineLogicFunction({
  universalIdentifier: LANDING,
  name: 'landing',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
