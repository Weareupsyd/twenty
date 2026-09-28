import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { QUOTE_RESUME } from 'src/constants/universal-identifiers';
import { htmlResponse } from 'src/lib/http';
import { renderErrorPage, renderResumePage } from 'src/lib/pages';
import { normalizeUgPhone } from 'src/lib/phones';
import { CoreDbClient } from 'src/lib/records';
import { findQuoteByRef } from 'src/lib/service-quotes';

const handler = async (event: RoutePayload): Promise<Response> => {
  const rawPhone = (event.queryStringParameters?.phone ?? '').trim();
  const rawRef = (event.queryStringParameters?.ref ?? '').trim().toUpperCase();
  const phone = rawPhone ? normalizeUgPhone(rawPhone) : '';
  const db = new CoreDbClient();

  // No search yet — show empty form
  if (!phone && !rawRef) {
    return htmlResponse(
      renderResumePage({ quotes: [], phone: rawPhone, ref: '', policyMap: {} }),
    );
  }

  const quotes: any[] = [];
  if (rawRef) {
    const quote = await findQuoteByRef(db, rawRef);
    if (!quote) {
      return htmlResponse(
        renderErrorPage('Quote not found', `No quote with reference ${rawRef}. Try your phone number instead.`),
        404,
      );
    }
    quotes.push(quote);
  } else if (phone) {
    const found = await db.findMany(
      'insuranceQuotes',
      { filter: { policyholderPhone: { eq: phone } }, first: 50 },
      ['reference', 'status', 'plate', 'vehicleMake', 'vehicleModel', 'vehicleValue', 'premium', 'policyholderPhone', 'validUntil'],
    );
    // Also try rawPhone fallback if normalize changed format
    const fallback = phone !== rawPhone
      ? await db.findMany(
          'insuranceQuotes',
          { filter: { policyholderPhone: { eq: rawPhone } }, first: 50 },
          ['reference', 'status', 'plate', 'vehicleMake', 'vehicleModel', 'vehicleValue', 'premium', 'policyholderPhone', 'validUntil'],
        )
      : [];
    const seen = new Set<string>();
    for (const q of [...found, ...fallback]) {
      const ref = String((q as any).reference);
      if (seen.has(ref)) continue;
      seen.add(ref);
      quotes.push(q);
    }
    if (quotes.length === 0) {
      return htmlResponse(
        renderResumePage({ quotes: [], phone: rawPhone, ref: '', policyMap: {} }),
      );
    }
  }

  // Build policy + payment maps for each quote
  const policyMap: Record<string, any> = {};
  const paymentsMap: Record<string, any[]> = {};
  for (const q of quotes) {
    const ref = String((q as any).reference);
    const policy = await db.findFirst(
      'insurancePolicies',
      { quoteRef: { eq: ref } },
      ['policyNo', 'status', 'plate', 'premiumUgx', 'periodStart', 'periodEnd', 'quoteRef'],
    );
    policyMap[ref] = policy;
    const payments = await db.findMany(
      'insurancePayments',
      { filter: { quoteRef: { eq: ref } }, first: 10 },
      ['paymentRef', 'status', 'provider', 'amountUgx', 'quoteRef'],
    );
    paymentsMap[ref] = payments;
  }

  return htmlResponse(
    renderResumePage({ quotes, phone: rawPhone, ref: rawRef, policyMap, paymentsMap }),
  );
};

export default defineLogicFunction({
  universalIdentifier: QUOTE_RESUME,
  name: 'quote-resume',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/quotes/resume',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
