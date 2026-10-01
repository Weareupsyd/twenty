import { CoreApiClient } from 'twenty-client-sdk/core';

// `twenty apply` regenerates twenty-client-sdk's core client from the workspace
// schema after every successful sync, so its query/mutation types reject the
// dynamic record names and raw record values these requests are built from.
// Consume the client through this shape that survives regeneration: requests go
// in as plain objects and answers are read field by field.
export type CoreGraphQlClient = {
  query: (request: Record<string, unknown>) => Promise<unknown>;
  mutation: (request: Record<string, unknown>) => Promise<unknown>;
};

export const coreGraphQlClient = (
  options: { runAs?: 'user' | 'application' } = {},
): CoreGraphQlClient =>
  new CoreApiClient(options) as unknown as CoreGraphQlClient;
