import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { kv } from 'twenty-sdk/logic-function';
import { WHATSAPP_SETTINGS_SAVE } from 'src/constants/universal-identifiers';
import { errorResponse, jsonResponse, parseJsonBody } from 'src/lib/http';
import { saveWhatsAppSettings } from 'src/lib/whatsapp-settings-service';

export const handler = async (event: RoutePayload) => {
  try {
    const result = await saveWhatsAppSettings(kv, parseJsonBody(event));
    return jsonResponse(result, result.ok ? 200 : 400);
  } catch (error) {
    return errorResponse(error, 500);
  }
};

export default defineLogicFunction({
  universalIdentifier: WHATSAPP_SETTINGS_SAVE,
  name: 'whatsapp-settings-save',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/settings/whatsapp',
    httpMethod: 'POST',
    isAuthRequired: true,
  },
});
