import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { API_CALC_CONFIG } from 'src/constants/universal-identifiers';
import { jsonResponse } from 'src/lib/http';
import { pricingFromEnv } from 'src/lib/pricing';

const handler = async (_event: RoutePayload): Promise<Response> => {
  const pricing = pricingFromEnv();
  return jsonResponse({
    ok: true,
    rate: pricing.rate,
    minVehicleValue: pricing.minValue,
    maxVehicleValue: pricing.maxValue,
    policyDays: pricing.policyDays,
    quoteValidityDays: pricing.quoteValidityDays,
    productCode: process.env.PRODUCT_CODE ?? 'BODE-01',
    supportPhone: process.env.SUPPORT_PHONE ?? '',
  });
};

export default defineLogicFunction({
  universalIdentifier: API_CALC_CONFIG,
  name: 'api-calc-config',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/api/calc-config',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
