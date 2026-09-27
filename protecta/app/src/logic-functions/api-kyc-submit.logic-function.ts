import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { API_KYC_SUBMIT } from 'src/constants/universal-identifiers';
import { errorResponse, jsonResponse, parseJsonBody, str } from 'src/lib/http';
import { CoreDbClient } from 'src/lib/records';
import { submitKyc } from 'src/lib/service-kyc';

export const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const body = parseJsonBody(event);
    const result = await submitKyc(new CoreDbClient(), {
      phone: str(body.phone),
      name: str(body.policyholderName) || str(body.name),
      idType: str(body.idType) || 'NIN',
      idNumber: str(body.nationalIdNumber) || str(body.idNumber),
      reviewNotes: JSON.stringify({
        dateOfBirth: str(body.dateOfBirth),
        nationalIdFrontUrl: str(body.nationalIdFrontUrl),
        nationalIdBackUrl: str(body.nationalIdBackUrl),
        logbookNumber: str(body.logbookNumber),
        driverPermitNumber: str(body.driverPermitNumber),
        quoteRef: str(body.quoteRef),
        vehiclePlate: str(body.vehiclePlate),
      }),
    });
    return jsonResponse({ ok: true, kyc: result.kycCase }, 201);
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
