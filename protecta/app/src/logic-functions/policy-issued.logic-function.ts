import { defineLogicFunction } from 'twenty-sdk/define';
import { kv, RetryableLogicFunctionError } from 'twenty-sdk/logic-function';
import { POLICY_ISSUED } from 'src/constants/universal-identifiers';
import { emailConfigFromEnv, sendEmail } from 'src/lib/email';
import { escapeHtml, publicBaseUrl } from 'src/lib/http';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { CoreDbClient } from 'src/lib/records';
import { policyCertUrl } from 'src/lib/service-policies';
import { findQuoteByRef } from 'src/lib/service-quotes';

export const handler = async (payload: { quoteRef: string }) => {
  const config = emailConfigFromEnv();
  if (!config) return { skipped: 'Email provider is not configured.' };
  const db = new CoreDbClient();
  const policy = await db.findFirst(
    'insurancePolicies',
    { quoteRef: { eq: payload.quoteRef } },
    ['policyNo'],
  );
  const quote = await findQuoteByRef(db, payload.quoteRef);
  if (!policy || !quote) throw new Error('Issued policy or quote not found.');
  const key = `policy-email:${policy.id}`;
  if (await kv.get(key)) return { alreadySent: true };
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
  if (!to) return { skipped: 'Customer has no email address.' };
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
};
export default defineLogicFunction({
  universalIdentifier: POLICY_ISSUED,
  name: 'policy-issued',
  timeoutSeconds: 30,
  handler,
});
