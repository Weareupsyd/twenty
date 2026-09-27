import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { API_OTP_VERIFY } from 'src/constants/universal-identifiers';
import { errorResponse, jsonResponse, parseJsonBody } from 'src/lib/http';
import { normalizeUgPhone } from 'src/lib/phones';
import { CoreDbClient } from 'src/lib/records';
import { verifyOtp } from 'src/lib/service-otp';

const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const body = parseJsonBody(event);
    const phone = normalizeUgPhone(String(body.phone ?? ''));
    const code = String(body.code ?? '').replace(/\D/g, '');
    if (!phone || code.length !== 6) {
      return jsonResponse({ ok: false, error: 'A valid phone and 6-digit code are required.' }, 400);
    }
    const session = await verifyOtp(new CoreDbClient(), phone, code);
    if (!session) {
      return jsonResponse({ ok: false, error: 'Invalid or expired code.' }, 401);
    }
    return jsonResponse({ ok: true, phone, session: session.token });
  } catch (error) {
    return errorResponse(error);
  }
};

export default defineLogicFunction({
  universalIdentifier: API_OTP_VERIFY,
  name: 'api-otp-verify',
  timeoutSeconds: 20,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/api/otp/verify',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
});
