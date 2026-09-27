import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { API_OTP_REQUEST } from 'src/constants/universal-identifiers';
import { errorResponse, jsonResponse, parseJsonBody } from 'src/lib/http';
import { normalizeUgPhone } from 'src/lib/phones';
import { issueOtp } from 'src/lib/service-otp';

const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const body = parseJsonBody(event);
    const phone = normalizeUgPhone(String(body.phone ?? ''));
    if (!phone) {
      return jsonResponse(
        { ok: false, error: 'A valid phone is required.' },
        400,
      );
    }
    const otp = await issueOtp(phone);
    return jsonResponse({
      ok: true,
      phone,
      expiresInMinutes: otp.expiresInMinutes,
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export default defineLogicFunction({
  universalIdentifier: API_OTP_REQUEST,
  name: 'api-otp-request',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/api/otp/request',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
});
