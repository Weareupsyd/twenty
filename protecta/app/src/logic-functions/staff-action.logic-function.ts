import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { STAFF_ACTION } from 'src/constants/universal-identifiers';
import { errorResponse, jsonResponse, parseJsonBody, str } from 'src/lib/http';
import { CoreDbClient } from 'src/lib/records';
import { runStaffAction } from 'src/lib/staff-actions';

export const handler = async (event: RoutePayload) => {
  try {
    const body = parseJsonBody(event);
    const id = str(body.id);
    if (!/^[0-9a-f-]{36}$/i.test(id))
      return jsonResponse(
        { ok: false, error: 'A record ID is required.' },
        400,
      );
    // Never execute a staff request with the application's elevated role.
    const result = await runStaffAction(
      new CoreDbClient({ runAs: 'user' }),
      str(body.action),
      id,
    );
    return jsonResponse({ ok: true, result });
  } catch (error) {
    return errorResponse(error);
  }
};
export default defineLogicFunction({
  universalIdentifier: STAFF_ACTION,
  name: 'staff-action',
  timeoutSeconds: 60,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/staff/action',
    httpMethod: 'POST',
    isAuthRequired: true,
  },
});
