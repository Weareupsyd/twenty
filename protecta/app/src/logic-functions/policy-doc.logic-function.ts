import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { POLICY_DOC } from 'src/constants/universal-identifiers';
import { htmlResponse } from 'src/lib/http';
import { renderErrorPage, renderPolicyPage } from 'src/lib/pages';
import { CoreDbClient } from 'src/lib/records';
import { findPolicyByNo } from 'src/lib/service-policies';

const handler = async (event: RoutePayload): Promise<Response> => {
  const ref = (event.queryStringParameters?.ref ?? '').trim().toUpperCase();
  if (!ref) {
    return htmlResponse(renderErrorPage('Missing reference', 'Provide ?ref=<policyNo>.'), 400);
  }
  const db = new CoreDbClient();
  const policy = await findPolicyByNo(db, ref);
  if (!policy) {
    return htmlResponse(
      renderErrorPage('Policy not found', `No policy with number ${ref}.`),
      404,
    );
  }
  // Generated documents come from the optional Document Generator app;
  // when it is not installed the lookup simply finds nothing.
  let documents: { reference: string }[] = [];
  try {
    const rows = await db.findMany(
      'generatedDocuments',
      {
        filter: { policyNo: { eq: ref }, status: { eq: 'GENERATED' } },
        first: 5,
      },
      ['reference'],
    );
    documents = rows.map((row) => ({ reference: String(row.reference) }));
  } catch {
    documents = [];
  }
  return htmlResponse(renderPolicyPage(policy, documents));
};

export default defineLogicFunction({
  universalIdentifier: POLICY_DOC,
  name: 'policy-doc',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/policies/doc',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
