import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { API_CUSTOMER_POLICIES } from 'src/constants/universal-identifiers';
import { verifyJwtHs256 } from 'src/lib/crypto';
import { errorResponse, jsonResponse } from 'src/lib/http';
import { normalizeUgPhone } from 'src/lib/phones';
import { CoreDbClient } from 'src/lib/records';
import { findPoliciesByPhone } from 'src/lib/service-policies';

/**
 * Self-service policy listing. The caller proves ownership of the phone
 * number with a session token from OTP verification.
 */
const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const phone = normalizeUgPhone(event.queryStringParameters?.phone ?? '');
    const session = (event.queryStringParameters?.session ?? '').trim();
    if (!phone) {
      return jsonResponse({ ok: false, error: 'A valid ?phone= is required.' }, 400);
    }
    const secret = process.env.SESSION_JWT_SECRET ?? '';
    if (!secret) {
      return jsonResponse({ ok: false, error: 'Sessions are not configured.' }, 500);
    }
    const claims = verifyJwtHs256<{ sub?: string }>(session, secret);
    if (!claims || claims.sub !== phone) {
      return jsonResponse({ ok: false, error: 'Invalid or expired session.' }, 401);
    }
    const policies = await findPoliciesByPhone(new CoreDbClient(), phone);
    return jsonResponse({ ok: true, phone, policies });
  } catch (error) {
    return errorResponse(error);
  }
};

export default defineLogicFunction({
  universalIdentifier: API_CUSTOMER_POLICIES,
  name: 'api-customer-policies',
  timeoutSeconds: 20,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/api/policies',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
