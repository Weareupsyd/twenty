import { APIError } from './errorHandler.js';
import { logger } from '@/utils/logger.js';

export class AuthenticationUnavailableError extends APIError {
  constructor() {
    super('Authentication service temporarily unavailable', 503, 'SERVICE_UNAVAILABLE');
    this.name = 'AuthenticationUnavailableError';
  }
}

// Both adapters use PGRST116 for a missing .single() result. That is an
// authentication rejection; database/network/schema errors are not. Never
// report a DB outage as "Invalid API key" or expose driver details to callers.
export function throwOnAuthDatabaseError(error: { code?: string } | null | undefined): void {
  if (error && error.code !== 'PGRST116') {
    logger.error('Authentication database lookup failed', { code: error.code || 'UNKNOWN' });
    throw new AuthenticationUnavailableError();
  }
}
