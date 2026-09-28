import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { SMS_ROUTE } from 'src/constants/universal-identifiers';
import { jsonResponse, parseJsonBody, str } from 'src/lib/http';
import { CoreDbClient } from 'src/lib/records';
import { deliverSms } from 'src/lib/service-sms';

/**
 * Programmatic trigger used by the Protecta Bode app and other apps:
 * POST { phone, eventKey?, language?, variables?, message? }. Either a
 * template eventKey or a raw message is required.
 */
const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const body = parseJsonBody(event);
    const query = event.queryStringParameters ?? {};
    const phone = (str(body.phone) || str(query.phone)).trim();
    if (!phone) {
      return jsonResponse({ ok: false, error: 'phone is required.' }, 400);
    }
    const eventKey = (str(body.eventKey) || str(query.eventKey)).trim();
    const message = str(body.message).trim();
    if (!eventKey && !message) {
      return jsonResponse(
        { ok: false, error: 'eventKey or message is required.' },
        400,
      );
    }
    const language = (str(body.language) || str(query.language)).trim();
    const variables = (body.variables ?? {}) as Record<string, unknown>;
    const vars = Object.fromEntries(
      Object.entries(variables).map(([key, value]) => [key, String(value ?? '')]),
    );
    const outcome = await deliverSms(new CoreDbClient(), {
      recipient: phone,
      eventKey: eventKey || undefined,
      language: language || undefined,
      variables: vars,
      message: message || undefined,
    });
    if (outcome.outcome === 'SKIPPED') {
      return jsonResponse(
        { ok: false, error: outcome.error ?? 'Could not send.' },
        422,
      );
    }
    return jsonResponse(
      {
        ok: outcome.outcome === 'SENT',
        reference: outcome.record?.reference ?? '',
        status: outcome.record?.status ?? outcome.outcome,
        providerRef: outcome.record?.providerRef ?? '',
        error: outcome.error ?? '',
      },
      outcome.outcome === 'SENT' ? 201 : 502,
    );
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'Failed.' },
      400,
    );
  }
};

export default defineLogicFunction({
  universalIdentifier: SMS_ROUTE,
  name: 'send-sms',
  description:
    'Sends an SMS on demand (POST { phone, eventKey?, language?, variables?, message? }).',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/sms/send',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
});
