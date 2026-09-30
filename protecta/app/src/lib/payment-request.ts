import { type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import {
  airtelAccessToken,
  airtelConfigFromEnv,
  airtelRequestPayment,
} from 'src/lib/airtel';
import {
  errorResponse,
  jsonResponse,
  parseJsonBody,
  publicBaseUrl,
  str,
} from 'src/lib/http';
import { formatUgx } from 'src/lib/money';
import {
  momoAccessToken,
  momoConfigFromEnv,
  momoRequestToPay,
} from 'src/lib/momo';
import { normalizeUgPhone } from 'src/lib/phones';
import { CoreDbClient } from 'src/lib/records';
import { confirmAndIssue } from 'src/lib/confirm-pipeline';
import { createPayment, normalizeProvider } from 'src/lib/service-payments';
import { findQuoteByRef } from 'src/lib/service-quotes';

export const handlePaymentRequest = async (
  event: RoutePayload,
): Promise<Response> => {
  try {
    const body = parseJsonBody(event);
    const db = new CoreDbClient();
    const quoteRef = str(body.quoteRef).trim();
    if (!quoteRef) {
      return jsonResponse({ ok: false, error: 'quoteRef is required.' }, 400);
    }
    const quote = await findQuoteByRef(db, quoteRef);
    if (!quote) {
      return jsonResponse({ ok: false, error: 'Quote not found.' }, 404);
    }
    if (quote.status === 'EXPIRED') {
      return jsonResponse({ ok: false, error: 'This quote has expired.' }, 400);
    }
    if (quote.status === 'ACCEPTED') {
      return jsonResponse(
        { ok: false, error: 'This quote is already paid.' },
        400,
      );
    }
    const provider = normalizeProvider(str(body.provider));
    if (!provider) {
      return jsonResponse(
        {
          ok: false,
          error: 'provider must be mtn_momo, airtel_money or bank.',
        },
        400,
      );
    }
    const payerPhone = normalizeUgPhone(str(body.payerPhone));
    if (!payerPhone) {
      return jsonResponse(
        { ok: false, error: 'A valid payerPhone is required.' },
        400,
      );
    }

    const payment = await createPayment(db, {
      quoteId: String(quote.id),
      quoteRef: String(quote.reference),
      amountUgx: Number(quote.premium),
      provider,
      payerPhone,
    });

    if (provider === 'bank') {
      return jsonResponse(
        {
          ok: true,
          payment,
          instructions:
            `Transfer ${formatUgx(Number(quote.premium))} to Stanbic Bank Uganda 9030005603063 ` +
            `with reference ${quote.reference}. Your cover activates once the transfer confirms.`,
        },
        201,
      );
    }

    if (provider === 'mtn_momo') {
      const config = momoConfigFromEnv();
      if (!config) {
        // Demo / sandbox: no MoMo credentials — simulate a successful payment
        // so the portal shows a real policy number and the record appears in Twenty.
        try {
          const { policy } = await confirmAndIssue(db, payment, { baseUrl: publicBaseUrl() });
          return jsonResponse(
            {
              ok: true,
              payment: { ...payment, status: 'CONFIRMED' },
              policy,
              draft: true,
              instructions: `Demo payment confirmed — policy ${String(policy.policyNo)} is active. Download the full policy PDF and verify the phone number used at purchase.`,
            },
            201,
          );
        } catch (e) {
          console.error('demo confirm failed', e);
          return jsonResponse(
            {
              ok: true,
              payment,
              draft: true,
              instructions: `Payment request for ${formatUgx(Number(quote.premium))} received. Your cover is being processed. Reference ${String(payment.paymentRef)}.`,
            },
            201,
          );
        }
      }
      try {
        const token = await momoAccessToken(config);
        const base = publicBaseUrl();
        await momoRequestToPay(config, token, {
          amount: Number(quote.premium),
          phone: payerPhone,
          externalId: String(payment.paymentRef),
          payeeNote: `Protecta Bode ${quote.reference}`,
          callbackUrl: base ? `${base}/s/protecta/payments/callback` : '',
        });
      } catch (error) {
        console.error('momo request failed', error);
        return jsonResponse(
          {
            ok: true,
            payment,
            providerPending: true,
            instructions:
              'We could not reach MTN MoMo. No payment prompt was confirmed. Contact support before trying again.',
          },
          201,
        );
      }
      return jsonResponse(
        {
          ok: true,
          payment,
          instructions: `Payment prompt sent to ${payerPhone}. Approve it on your phone…`,
        },
        201,
      );
    }

    const config = airtelConfigFromEnv();
    if (!config) {
      try {
        const { policy } = await confirmAndIssue(db, payment, { baseUrl: publicBaseUrl() });
        return jsonResponse(
          {
            ok: true,
            payment: { ...payment, status: 'CONFIRMED' },
            policy,
            draft: true,
            instructions: `Demo payment confirmed — policy ${String(policy.policyNo)} is active. Download the full policy PDF and verify the phone number used at purchase.`,
          },
          201,
        );
      } catch (e) {
        console.error('demo confirm failed', e);
        return jsonResponse(
          {
            ok: true,
            payment,
            draft: true,
            instructions: `Payment request for ${formatUgx(Number(quote.premium))} received. Your cover is being processed. Reference ${String(payment.paymentRef)}.`,
          },
          201,
        );
      }
    }
    try {
      const token = await airtelAccessToken(config);
      const result = await airtelRequestPayment(config, token, {
        amount: Number(quote.premium),
        phone: payerPhone,
        externalId: String(payment.paymentRef),
      });
      if (result.transactionId) {
        await db.update('insurancePayment', String(payment.id), {
          providerRef: result.transactionId,
        });
      }
    } catch (error) {
      console.error('airtel request failed', error);
      return jsonResponse(
        {
          ok: true,
          payment,
          providerPending: true,
          instructions:
            'We could not reach Airtel Money. No payment prompt was confirmed. Contact support before trying again.',
        },
        201,
      );
    }
    return jsonResponse(
      {
        ok: true,
        payment,
        instructions: `Payment prompt sent to ${payerPhone}. Approve it on your phone…`,
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
};
