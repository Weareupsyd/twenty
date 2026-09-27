import { doubleCsrf } from 'csrf-csrf';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '@/config/index.js';

const isProd = config.nodeEnv === 'production';

export const {
  generateToken,
  doubleCsrfProtection,
} = doubleCsrf({
  getSecret: () => config.jwtSecret,
  // __Host- prefix requires Secure flag - only usable over HTTPS (production)
  cookieName: isProd ? '__Host-psifi.x-csrf-token' : '_csrf',
  cookieOptions: {
    sameSite: 'strict',
    secure: isProd,
    httpOnly: true,
    path: '/',
  },
  size: 64,
  getTokenFromRequest: (req) => req.headers['x-csrf-token'] as string,
  // Give the library's rejection a stable shape - see conditionalCsrf below,
  // which turns it into a JSON 403 before the global error handler can mask it.
  errorConfig: {
    statusCode: 403,
    message: 'Invalid CSRF token',
    code: 'CSRF_INVALID',
  },
});

/**
 * Paths that are exempt from CSRF enforcement because they use alternative
 * protection mechanisms (e.g. OAuth state parameter).
 */
const CSRF_EXEMPT_PATHS = [
  '/api/auth/developer/github/callback', // protected by HMAC-signed OAuth state
  '/api/auth/developer/otp/send',        // pre-auth flow, protected by rate limiting
  '/api/auth/developer/otp/verify',      // pre-auth flow, protected by OTP + rate limiting
  '/api/auth/developer/otp/complete-registration', // signed short-lived registration token
  '/api/auth/whatsapp/complete-registration',      // signed short-lived registration token
  '/api/auth/reviewer/otp/send',         // pre-auth flow, protected by rate limiting
  '/api/auth/reviewer/otp/verify',       // pre-auth flow, protected by OTP + rate limiting
  '/api/auth/service-operator/otp/send',     // pre-auth flow, protected by rate limiting + OTP
  '/api/auth/service-operator/otp/verify',   // pre-auth flow, protected by rate limiting + OTP
  '/api/auth/service-operator/otp/select',   // short-lived selection token + rate limiting
  '/api/auth/login',                         // Phase 3 unified staff login (rate limited)
  '/api/auth/login/whatsapp',                // Phase 3 staff WhatsApp OTP send
  '/api/auth/login/whatsapp/verify',         // Phase 3 staff WhatsApp OTP verify
];

/**
 * Conditional CSRF middleware - only enforces when a *valid* auth cookie is present.
 * A stale/expired cookie (e.g. from a previous session) is ignored so that
 * pre-auth flows like OTP send/verify are not blocked by CSRF enforcement.
 */
export function conditionalCsrf(req: Request, res: Response, next: NextFunction): void {
  // Skip CSRF for routes with alternative protection (OAuth callbacks, etc.)
  if (CSRF_EXEMPT_PATHS.includes(req.originalUrl.split('?')[0])) {
    next();
    return;
  }
  const token = req.cookies?.kabila_token;
  if (token) {
    try {
      jwt.verify(token, config.jwtSecret);
      doubleCsrfProtection(req, res, (err?: any) => {
        if (!err) {
          next();
          return;
        }
        // csrf-csrf hands back its http-errors ForbiddenError here. Respond
        // directly with the documented client contract - 403 + code
        // CSRF_INVALID - instead of routing it to the global error handler.
        // (The handler now honours exposed 4xx statuses, so this is defense in
        // depth: without the interception a stale cookie used to surface as a
        // generic 500 "Something went wrong!", which bricked the developer
        // portal and paged like an outage.)
        res.status(403).json({
          status: 'error',
          message: 'Invalid CSRF token',
          code: 'CSRF_INVALID',
        });
      });
      return;
    } catch {
      // Token expired/invalid - treat as unauthenticated, skip CSRF
    }
  }
  next();
}

export { doubleCsrfProtection as csrfProtection };
