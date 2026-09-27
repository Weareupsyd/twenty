import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { PARTNER_TOKEN } from 'src/constants/universal-identifiers';
import { jsonResponse, parseJsonBody, requireEnv, str } from 'src/lib/http';
import { CoreDbClient } from 'src/lib/records';
import {
  authenticatePartner,
  PARTNER_TOKEN_TTL_SECONDS,
} from 'src/lib/service-partners';

export const handler = async (event: RoutePayload) => {
  const secret = requireEnv('PARTNER_JWT_SECRET');
  const body = parseJsonBody(event);
  try {
    const { token, scopes } = await authenticatePartner(new CoreDbClient(), {
      clientId: str(body.clientId),
      clientSecret: str(body.clientSecret),
      jwtSecret: secret,
    });
    return jsonResponse({
      access_token: token,
      token_type: 'Bearer',
      expires_in: PARTNER_TOKEN_TTL_SECONDS,
      scopes,
    });
  } catch {
    return jsonResponse(
      { ok: false, error: 'Invalid client credentials.' },
      401,
    );
  }
};
export default defineLogicFunction({
  universalIdentifier: PARTNER_TOKEN,
  name: 'partner-token',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/api/partners/token',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
});
