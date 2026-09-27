/**
 * Postgres / node-pg errors that mean the connection is gone, not that
 * application SQL failed.
 *
 * Class 08 = connection_exception
 * Class 57 = operator_intervention (admin_shutdown, crash_shutdown, …)
 *
 * node-pg re-emits idle-client errors on the Pool. Without a listener they
 * become Node uncaughtException. The process must not die for these - the
 * pool already discards the dead client and the next query opens a new one.
 */

export const RECOVERABLE_PG_DISCONNECT_CODES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '57P04', // database_dropped
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08P01', // protocol_violation (often a dropped/half-closed socket)
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
]);

const RECOVERABLE_MESSAGE =
  /terminating connection|connection terminated|server closed the connection|Connection terminated unexpectedly/i;

export function pgErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function isRecoverablePgDisconnect(err: unknown): boolean {
  const code = pgErrorCode(err);
  if (code && RECOVERABLE_PG_DISCONNECT_CODES.has(code)) return true;
  const message =
    err instanceof Error
      ? err.message
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : '';
  return RECOVERABLE_MESSAGE.test(message);
}

/** Fields safe to log. Never include `err.client` - node-pg attaches the whole Client. */
export function summarizePgError(err: unknown): {
  code?: string;
  message: string;
  severity?: string;
} {
  const e = err as { code?: unknown; message?: unknown; severity?: unknown };
  return {
    code: typeof e?.code === 'string' ? e.code : undefined,
    message: typeof e?.message === 'string' ? e.message : String(err),
    severity: typeof e?.severity === 'string' ? e.severity : undefined,
  };
}
