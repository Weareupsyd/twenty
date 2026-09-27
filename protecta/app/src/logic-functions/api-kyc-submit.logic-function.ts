import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { API_KYC_SUBMIT } from 'src/constants/universal-identifiers';
import { errorResponse, jsonResponse, parseJsonBody, str } from 'src/lib/http';
import { CoreDbClient } from 'src/lib/records';
import { submitKyc } from 'src/lib/service-kyc';

const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const body = parseJsonBody(event);
    const result = await submitKyc(new CoreDbClient(), {
      phone: str(body.phone),
      policyholderName: str(body.policyholderName),
      dateOfBirth: str(body.dateOfBirth),
      nationalIdNumber: str(body.nationalIdNumber),
      nationalIdFrontUrl: str(body.nationalIdFrontUrl) || undefined,
      nationalIdBackUrl: str(body.nationalIdBackUrl) || undefined,
      logbookNumber: str(body.logbookNumber) || undefined,
      driverPermitNumber: str(body.driverPermitNumber) || undefined,
      quoteRef: str(body.quoteRef) || undefined,
      vehiclePlate: str(body.vehiclePlate) || undefined,
    });
    return jsonResponse({ ok: true, kyc: result.kyc }, 201);
  } catch (error) {
    return errorResponse(error);
  }
};

export default defineLogicFunction({
  universalIdentifier: API_KYC_SUBMIT,
  name: 'api-kyc-submit',
  timeoutSeconds: 20,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/api/kyc',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
});
