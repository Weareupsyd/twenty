import { defineLogicFunction } from 'twenty-sdk/define';
import { kv, RetryableLogicFunctionError } from 'twenty-sdk/logic-function';
import { POLICY_ISSUED } from 'src/constants/universal-identifiers';
import { emailConfigFromEnv, sendEmail } from 'src/lib/email';
import { escapeHtml, publicBaseUrl } from 'src/lib/http';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { CoreDbClient } from 'src/lib/records';
import { policyCertUrl } from 'src/lib/service-policies';
import { findQuoteByRef } from 'src/lib/service-quotes';

const fmt = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value.toLocaleString('en-US');
  return String(value);
};

/**
 * Best-effort SMS through the SMS Sender app — its own logic functions
 * already react to policy creation, so the service suppresses duplicates
 * and this call is only a guaranteed nudge. Never throws.
 */
export const notifySms = async (input: {
  phone: string;
  variables: Record<string, string>;
}): Promise<string> => {
  try {
    const base = publicBaseUrl();
    const response = await fetch(`${base}/s/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: input.phone,
        eventKey: 'POLICY_ISSUED',
        variables: input.variables,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
    };
    return body.ok ? 'sent' : `not sent (${response.status})`;
  } catch {
    return 'not sent (unreachable)';
  }
};

export const handler = async (payload: { quoteRef: string }) => {
  const db = new CoreDbClient();
  const policy = await db.findFirst(
    'insurancePolicies',
    { quoteRef: { eq: payload.quoteRef } },
    ['policyNo', 'premiumUgx', 'plate', 'periodStart', 'periodEnd'],
  );
  const quote = await findQuoteByRef(db, payload.quoteRef);
  if (!policy || !quote) throw new Error('Issued policy or quote not found.');

  // The customer hears about the policy even when email is not set up.
  const sms = await notifySms({
    phone: String(quote.policyholderPhone ?? ''),
    variables: {
      policyNo: String(policy.policyNo ?? ''),
      quoteRef: String(payload.quoteRef),
      premiumUgx: fmt(policy.premiumUgx),
      plate: fmt(policy.plate),
      periodStart: fmt(policy.periodStart),
      periodEnd: fmt(policy.periodEnd),
    },
  });

  const config = emailConfigFromEnv();
  if (!config) {
    return { skipped: 'Email provider is not configured.', sms };
  }
  const key = `policy-email:${policy.id}`;
  if (await kv.get(key)) return { alreadySent: true, sms };
  const data = (await new CoreApiClient().query({
    people: {
      __args: {
        filter: { protectaPhone: { eq: quote.policyholderPhone } },
        first: 1,
      },
      edges: { node: { emails: { primaryEmail: true } } },
    },
  })) as {
    people?: { edges?: { node: { emails?: { primaryEmail?: string } } }[] };
  };
  const to = data.people?.edges?.[0]?.node.emails?.primaryEmail;
  if (!to) return { skipped: 'Customer has no email address.', sms };
  try {
    await sendEmail(config, {
      to,
      subject: `Protecta policy ${policy.policyNo}`,
      html: `<p>Your policy ${escapeHtml(String(policy.policyNo))} is active.</p><p><a href="${escapeHtml(policyCertUrl(publicBaseUrl(), String(policy.policyNo)))}">View your certificate</a></p>`,
      idempotencyKey: key,
    });
    await kv.set(key, true);
  } catch {
    throw new RetryableLogicFunctionError('Policy email delivery failed.');
  }
  return { sms };
};
export default defineLogicFunction({
  universalIdentifier: POLICY_ISSUED,
  name: 'policy-issued',
  timeoutSeconds: 30,
  handler,
});
