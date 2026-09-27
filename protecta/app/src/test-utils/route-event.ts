import { type RoutePayload } from 'twenty-sdk/define';
export const routeEvent = (
  overrides: Partial<RoutePayload> = {},
): RoutePayload => ({
  headers: {},
  body: null,
  queryStringParameters: {},
  pathParameters: {},
  isBase64Encoded: false,
  requestContext: { http: { method: 'POST', path: '/' } },
  userWorkspaceId: null,
  ...overrides,
});
