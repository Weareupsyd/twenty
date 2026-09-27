import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { createTimelineActivity, Response } from 'twenty-sdk/logic-function';
import {
  API_CLAIM_CREATE,
  INSURANCE_CLAIM,
  TIMELINE_CLAIM_UPDATED,
} from 'src/constants/universal-identifiers';
import { queueWhatsApp } from 'src/lib/fanout';
import { errorResponse, jsonResponse, parseJsonBody, str } from 'src/lib/http';
import { CoreDbClient } from 'src/lib/records';
import { createClaim } from 'src/lib/service-claims';
import { claimUpdateMessage } from 'src/lib/whatsapp-text';

const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const body = parseJsonBody(event);
    const db = new CoreDbClient();
    const { claim } = await createClaim(db, {
      policyNo: str(body.policyNo),
      description: str(body.description),
      location: str(body.location) || undefined,
      reporterPhone: str(body.reporterPhone || body.phone),
      incidentDate: str(body.incidentDate) || undefined,
    });
    try {
      await createTimelineActivity({
        timelineActivityTypeUniversalIdentifier: TIMELINE_CLAIM_UPDATED,
        targetObjectUniversalIdentifier: INSURANCE_CLAIM,
        targetRecordId: String(claim.id),
        properties: { claimRef: claim.claimRef, status: 'REPORTED', channel: 'PORTAL' },
      });
    } catch (error) {
      console.error('claim timeline failed', error);
    }
    await queueWhatsApp(
      String(claim.reporterPhone),
      claimUpdateMessage({
        claimRef: String(claim.claimRef),
        status: 'REPORTED',
        note: 'We have your claim. An assessor will call you shortly.',
      }),
    );
    return jsonResponse({ ok: true, claim }, 201);
  } catch (error) {
    return errorResponse(error);
  }
};

export default defineLogicFunction({
  universalIdentifier: API_CLAIM_CREATE,
  name: 'api-claim-create',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/api/claims',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
});
