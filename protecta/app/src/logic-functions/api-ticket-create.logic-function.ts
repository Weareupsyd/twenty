import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { API_TICKET_CREATE } from 'src/constants/universal-identifiers';
import { errorResponse, jsonResponse, parseJsonBody, str } from 'src/lib/http';
import { CoreDbClient } from 'src/lib/records';
import { createTicket } from 'src/lib/service-tickets';

const handler = async (event: RoutePayload): Promise<Response> => {
  try {
    const body = parseJsonBody(event);
    const db = new CoreDbClient();
    const { ticket } = await createTicket(db, {
      phone: str(body.phone),
      subject: str(body.subject),
      description: str(body.description) || undefined,
      channel: str(body.channel) || 'PORTAL',
      priority: str(body.priority) || 'NORMAL',
    });
    return jsonResponse({ ok: true, ticket }, 201);
  } catch (error) {
    return errorResponse(error);
  }
};

export default defineLogicFunction({
  universalIdentifier: API_TICKET_CREATE,
  name: 'api-ticket-create',
  timeoutSeconds: 20,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/api/tickets',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
});
