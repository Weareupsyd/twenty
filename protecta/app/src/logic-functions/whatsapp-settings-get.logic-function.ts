import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { kv } from 'twenty-sdk/logic-function';
import { WHATSAPP_SETTINGS_GET } from 'src/constants/universal-identifiers';
import { errorResponse, jsonResponse } from 'src/lib/http';
import { whatsAppSettingsView } from 'src/lib/whatsapp-settings-service';

export const handler = async (_event: RoutePayload) => {
  try {
    return jsonResponse(await whatsAppSettingsView(kv));
  } catch (error) {
    return errorResponse(error, 500);
  }
};

export default defineLogicFunction({
  universalIdentifier: WHATSAPP_SETTINGS_GET,
  name: 'whatsapp-settings-get',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/settings/whatsapp',
    httpMethod: 'GET',
    isAuthRequired: true,
  },
});
