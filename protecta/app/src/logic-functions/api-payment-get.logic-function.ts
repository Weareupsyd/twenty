import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { API_PAYMENT_GET } from 'src/constants/universal-identifiers';
import { errorResponse, jsonResponse } from 'src/lib/http';
import { CoreDbClient } from 'src/lib/records';
import { findPaymentByRef } from 'src/lib/service-payments';

const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const ref = (event.queryStringParameters?.ref ?? '').trim();
    if (!ref) {
      return jsonResponse({ ok: false, error: 'Missing ?ref= payment reference.' }, 400);
    }
    const db = new CoreDbClient();
    const payment = await findPaymentByRef(db, ref);
    if (!payment) {
      return jsonResponse({ ok: false, error: 'Payment not found.' }, 404);
    }
    let policy: unknown = null;
    if (payment.status === 'CONFIRMED') {
      policy = await db.findFirst(
        'insurancePolicies',
        { quoteRef: { eq: String(payment.quoteRef) } },
        ['policyNo', 'status', 'periodStart', 'periodEnd'],
      );
    }
    return jsonResponse({ ok: true, payment, policy });
  } catch (error) {
    return errorResponse(error);
  }
};

export default defineLogicFunction({
  universalIdentifier: API_PAYMENT_GET,
  name: 'api-payment-get',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/api/payments/get',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
