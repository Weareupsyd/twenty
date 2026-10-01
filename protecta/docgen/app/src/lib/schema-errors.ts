/**
 * The generated API client validates every query against the workspace schema
 * snapshot it was built from at sync time. When an app is synced before another
 * app's objects exist — the Document Generator is applied before Protecta — the
 * objects it reads are missing from that snapshot and the query is rejected
 * client-side:
 *
 *     type `Query` does not have a field `insurancePolicies`
 *
 * start.sh now re-syncs the linked apps after Protecta so the snapshot is
 * complete. This helper lets the routes that still hit the stale case explain
 * what to run instead of surfacing a bare 500.
 */
const MISSING_FIELD = /does not have a field `([A-Za-z0-9_]+)`/;

/** The object the generated client cannot query, when that is the failure. */
export const missingSchemaField = (error: unknown): string | null => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const match = MISSING_FIELD.exec(message);

  return match ? match[1] : null;
};

/** What to run on the server to rebuild the affected client. */
export const STALE_CLIENT_REMEDY = './start.sh (or ./twenty.sh docgen apply .)';

/** One sentence describing the failure and the fix, for any response body. */
export const staleClientMessage = (field: string): string =>
  `The Document Generator cannot read \`${field}\`: it was synced before the ` +
  `Protecta app created those records. Re-sync it with ${STALE_CLIENT_REMEDY} ` +
  `and this document will build again.`;
