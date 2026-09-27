import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { createTimelineActivity, enqueueJobs, Response } from 'twenty-sdk/logic-function';
import {
  INSURANCE_PAYMENT,
  INSURANCE_POLICY,
  PAYMENTS_WEBHOOK,
  POLICY_ISSUED,
  TIMELINE_PAYMENT_CONFIRMED,
  TIMELINE_POLICY_ISSUED,
} from 'src/constants/universal-identifiers';
import { getQuoteAgent } from 'src/lib/attribution';
import { confirmAndIssue } from 'src/lib/confirm-pipeline';
import { hmacSha256Hex, signaturesEqual } from 'src/lib/crypto';
import { fanoutPartnerEvent, queueWhatsApp } from 'src/lib/fanout';
import { errorResponse, jsonResponse, parseJsonBody, publicBaseUrl, str } from 'src/lib/http';
import { CoreDbClient } from 'src/lib/records';
import { failPayment, findPaymentByRef } from 'src/lib/service-payments';
import { paymentConfirmedMessage, policyIssuedMessage } from 'src/lib/whatsapp-text';

const signatureOf = (secret: string, rawBody: string): string =>
  `sha256=${hmacSha256Hex(secret, rawBody)}`;

/**
 * Provider payment callback (MoMo, Airtel, aggregator). Verifies HMAC, then
 * confirms the payment and issues the policy exactly once.
 */
const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const rawBody = event.rawBody ?? JSON.stringify(event.body ?? {});
    const requireSignature = (process.env.REQUIRE_PAYMENT_SIGNATURE ?? 'true') === 'true';
    const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? '';
    if (requireSignature) {
      if (!secret) {
        return jsonResponse({ ok: false, error: 'Payment webhook not configured.' }, 500);
      }
      const provided =
        event.headers['x-protecta-signature'] ?? event.headers['X-Protecta-Signature'] ?? '';
      if (!provided || !signaturesEqual(provided, signatureOf(secret, rawBody))) {
        return jsonResponse({ ok: false, error: 'Invalid signature.' }, 401);
      }
    }

    const body = parseJsonBody(event);
    const paymentRef = (
      str(body.paymentRef) ||
      str(body.externalId) ||
      str(body.external_id) ||
      ''
    ).trim();
    const statusRaw = (
      str(body.status) ||
      str(body.transactionStatus) ||
      ''
    ).toUpperCase();
    const providerRef = str(body.providerRef || body.financialTransactionId || body.txnId);
    if (!paymentRef) {
      return jsonResponse({ ok: false, error: 'paymentRef/externalId is required.' }, 400);
    }

    const db = new CoreDbClient();
    const payment = await findPaymentByRef(db, paymentRef);
    if (!payment) {
      return jsonResponse({ ok: false, error: 'Payment not found.' }, 404);
    }

    const success = ['SUCCESSFUL', 'SUCCESS', 'CONFIRMED', 'COMPLETED'].includes(statusRaw);
    if (!success) {
      await failPayment(db, payment, providerRef || undefined);
      return jsonResponse({ ok: true, paymentRef, status: 'FAILED' });
    }

    let agentPersonId: string | undefined;
    try {
      agentPersonId = (await getQuoteAgent(String(payment.quoteRef))) ?? undefined;
    } catch {
      agentPersonId = undefined;
    }
    const { quote, policy } = await confirmAndIssue(db, payment, {
      providerRef: providerRef || undefined,
      agentPersonId,
      baseUrl: publicBaseUrl(),
    });

    try {
      await createTimelineActivity({
        timelineActivityTypeUniversalIdentifier: TIMELINE_PAYMENT_CONFIRMED,
        targetObjectUniversalIdentifier: INSURANCE_PAYMENT,
        targetRecordId: String(payment.id),
        properties: { paymentRef, quoteRef: quote.reference, amount: payment.amountUgx },
      });
      await createTimelineActivity({
        timelineActivityTypeUniversalIdentifier: TIMELINE_POLICY_ISSUED,
        targetObjectUniversalIdentifier: INSURANCE_POLICY,
        targetRecordId: String(policy.id),
        properties: { policyNo: policy.policyNo, quoteRef: quote.reference },
      });
    } catch (error) {
      console.error('payment timeline failed', error);
    }

    const base = publicBaseUrl();
    const phone = String(quote.policyholderPhone ?? payment.payerPhone ?? '');
    if (phone) {
      await queueWhatsApp(
        phone,
        paymentConfirmedMessage({
          quoteRef: String(quote.reference),
          amount: Number(payment.amountUgx),
          policyNo: String(policy.policyNo),
        }),
      );
      await queueWhatsApp(
        phone,
        policyIssuedMessage({
          policyNo: String(policy.policyNo),
          plate: String(policy.plate ?? quote.plate ?? ''),
          periodEnd: String(policy.periodEnd ?? ''),
          certUrl: base ? `${base}/s/protecta/policies/doc?ref=${policy.policyNo}` : '',
        }),
      );
    }
    await fanoutPartnerEvent(db, 'payment.confirmed', String(quote.reference), {
      paymentRef,
      quoteRef: quote.reference,
      amount: payment.amountUgx,
      policyNo: policy.policyNo,
    });
    await fanoutPartnerEvent(db, 'policy.issued', String(quote.reference), {
      policyNo: policy.policyNo,
      quoteRef: quote.reference,
    });

    try {
      await enqueueJobs({
        logicFunctionUniversalIdentifier: POLICY_ISSUED,
        jobs: [{ payload: { quoteRef: String(quote.reference), paymentId: String(payment.id) } }],
      });
    } catch (error) {
      console.error('policy-issued enqueue failed', error);
    }

    return jsonResponse({
      ok: true,
      paymentRef,
      status: 'CONFIRMED',
      policyNo: policy.policyNo,
    });
  } catch (error) {
    return errorResponse(error, 500);
  }
};

export default defineLogicFunction({
  universalIdentifier: PAYMENTS_WEBHOOK,
  name: 'payments-webhook',
  timeoutSeconds: 60,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/payments/callback',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-protecta-signature'],
  },
});
