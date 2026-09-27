import crypto from 'crypto';
import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { body } from 'express-validator';

import { supabase } from '@/config/database.js';
import config from '@/config/index.js';
import { generateAdminToken, generateComplianceToken, generateDeveloperToken, generateRegistrationToken, verifyRegistrationToken, generateReviewerToken, generateAPIKey, authenticateJWT } from '@/middleware/auth.js';
import { findStaffByEmail, findStaffById, findStaffByWhatsapp, touchStaffSession, upsertStaffFromLogin, verifyStaffPassword, type StaffRow } from '@/services/staffService.js';
import { resolveStaff } from '@/compliance/staffAuth.js';
import { catchAsync, ValidationError, AuthenticationError } from '@/middleware/errorHandler.js';
import { validate } from '@/middleware/validate.js';
import { TotpService } from '@/services/totpService.js';
import { createAndSendOtp, verifyOtp } from '@/services/otpService.js';
import * as githubOAuth from '@/services/githubOAuthService.js';
import { Developer } from '@/types/index.js';
import { logger } from '@/utils/logger.js';
import { generateToken } from '@/middleware/csrf.js';
import { resolvePublicAssetUrl } from '@/services/storage.js';

// Rate limiter for OTP verify: 10 attempts per 15 minutes per IP
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many verification attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for OTP send: 5 sends per 15 minutes per IP
const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many code requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for admin password login: 5 failed attempts per 15 min per IP.
//
// `skipSuccessfulRequests` skips res.status < 400. That's fine for the
// success path. But TOTP-enabled admins hit a 401 with `requires_totp:
// true` BEFORE the second factor is checked - that's not a real failed
// attempt (the password was correct), it's a protocol step. Without the
// `skip` callback below, a TOTP admin doing one normal login burns 2
// attempts (one for the protocol-step 401, one if they fat-finger the
// TOTP code). 5 attempts * 2 = self-lockout in 2-3 logins.
//
// The route handler sets `res.locals.requiresTotp = true` before
// returning the protocol-step 401; this `skip` callback ignores those.
// Real failed-credential 401s (wrong password) still count.
//
// Keyed per-IP, not per-account - per-account lockout would leak
// account existence (attacker observes which emails trigger lockout).
//
// The OTP routes above already have their own limiters. This limiter
// specifically protects the password-based admin login at /admin/login,
// which was previously only covered by the global 1000 req/hour limiter
// in server.ts - too generous for password brute-forcing.
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  skip: (_req, res) => res.locals?.requiresTotp === true,
  message: { message: 'Too many failed login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = express.Router();

// Set httpOnly auth cookie alongside JSON token response (H3 security fix)
function setAuthCookie(res: Response, token: string, maxAge = 7 * 24 * 60 * 60 * 1000): void {
  res.cookie('kabila_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge,
    path: '/',
  });
}

// POST /api/auth/logout - clear httpOnly auth cookie
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('kabila_token', { path: '/' });
  res.json({ message: 'Logged out' });
});

// POST /api/auth/developer/resolve-session
// A non-erroring auth probe for the developer portal. It avoids using the
// protected /api/developer/profile endpoint as a logged-out session check
// (which produced expected-but-noisy 401s in the browser console). When an
// admin arrives from the combined compliance console, exchange that verified
// staff cookie for a developer token scoped to their developer row, falling
// back to the dedicated hosted-page account.
router.post('/developer/resolve-session', async (req: Request, res: Response) => {
  const rawToken = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.kabila_token;
  if (!rawToken) return res.json({ authenticated: false });

  try {
    const decoded = jwt.verify(rawToken, config.jwtSecret, {
      issuer: 'kabila-api',
      audience: 'kabila-developer',
    }) as { id?: string; type?: string };
    if (decoded.type === 'developer' && decoded.id) {
      const { data: developer } = await supabase
        .from('developers')
        .select('id, status, is_verified')
        .eq('id', decoded.id)
        .eq('is_verified', true)
        .single();
      if (developer && developer.status !== 'suspended') {
        return res.json({ authenticated: true, principal: 'developer' });
      }
    }
  } catch { /* try the next supported token audience */ }

  try {
    jwt.verify(rawToken, config.jwtSecret, {
      issuer: 'kabila-api',
      audience: 'kabila-service-operator',
    });
    return res.json({ authenticated: true, principal: 'service-operator' });
  } catch { /* try compliance staff */ }

  try {
    const decoded = jwt.verify(rawToken, config.jwtSecret, {
      issuer: 'compliance',
      audience: 'compliance',
    }) as { id?: string; email?: string };
    const staff = decoded.id
      ? await findStaffById(decoded.id)
      : decoded.email
        ? await findStaffByEmail(decoded.email)
        : null;
    if (!staff?.is_active || staff.kyc_role !== 'admin' || staff.readonly) {
      return res.json({ authenticated: false, reason: 'developer_admin_required' });
    }

    let { data: developer } = await supabase
      .from('developers')
      .select('*')
      .eq('email', staff.email)
      .eq('is_verified', true)
      .single();
    if (!developer) {
      const fallback = await supabase
        .from('developers')
        .select('*')
        .eq('email', 'service+hosted-pages@kabila.app')
        .eq('is_verified', true)
        .single();
      developer = fallback.data;
    }
    if (!developer) {
      // No developer row for this staff email and no hosted fallback account.
      // Provision a VERIFIED developer row for the admin instead of
      // dead-ending on `hosted_developer_missing`: the bridge exists so
      // console admins can manage hosted pages/webhooks without a separate
      // OTP signup, and a per-email row is a tighter scope than the shared
      // hosted account.
      const { data: created, error: createError } = await supabase
        .from('developers')
        .insert({
          email: staff.email,
          name: staff.full_name || staff.email,
          company: 'Compliance Console',
          is_verified: true,
        })
        .select('*')
        .single();

      if (createError) {
        // Lost a race with a concurrent bridge (unique email)? Re-fetch
        // rather than failing the bridge.
        if (createError.code === '23505') {
          const retry = await supabase
            .from('developers')
            .select('*')
            .eq('email', staff.email)
            .eq('is_verified', true)
            .single();
          developer = retry.data;
        }
      } else {
        developer = created;
        logger.info('Provisioned developer row for compliance admin bridge', {
          staffId: staff.id,
          developerId: created.id,
        });
      }

      if (!developer) {
        logger.error('Failed to provision developer row for compliance admin', {
          staffId: staff.id,
          code: createError?.code,
          message: createError?.message,
        });
        return res.json({ authenticated: false, reason: 'developer_provisioning_failed' });
      }
    }
    if (developer.status === 'suspended') {
      return res.json({ authenticated: false, reason: 'hosted_developer_missing' });
    }

    const developerToken = generateDeveloperToken(developer);
    setAuthCookie(res, developerToken);
    logger.info('Compliance admin bridged to developer portal', {
      staffId: staff.id,
      developerId: developer.id,
    });
    return res.json({ authenticated: true, principal: 'developer', bridged: true });
  } catch {
    return res.json({ authenticated: false });
  }
});

// GET /api/auth/csrf-token - frontend calls this before any admin mutation
router.get('/csrf-token', catchAsync(async (req: Request, res: Response) => {
  // generateToken(req, res, overwrite = false, validateOnReuse = true) - the
  // defaults THROW when the browser presents a stored token|hash pair that no
  // longer validates (e.g. after a JWT_SECRET rotation, or any pre-rotation
  // cookie). Because the throw happens before the new cookie is set, the stale
  // cookie was never replaced and the browser 500'd on every retry, forever:
  // csrf-token 500 -> frontend has no header -> every authed mutation 403s
  // (surfaced as 500 too, see conditionalCsrf). Passing validateOnReuse=false
  // keeps reuse of a still-valid pair (multi-tab safe) but silently mints a
  // fresh token+cookie when the stored pair is missing or stale.
  const token = generateToken(req, res, false, false);
  res.json({ csrfToken: token });
}));

// Admin login
router.post('/admin/login',
  adminLoginLimiter,
  [
    body('email')
      .isEmail()
      .withMessage('Valid email is required'),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { email, password } = req.body;

    // Get admin user
    const { data: adminUser, error } = await supabase
      .from('admin_users')
      .select('*')
      .eq('email', email)
      .single();
    
    if (error || !adminUser) {
      logger.warn('Admin login attempt with invalid email', { email });
      throw new AuthenticationError('Invalid credentials');
    }
    
    // Check password
    const isValidPassword = await bcrypt.compare(password, adminUser.password_hash);
    if (!isValidPassword) {
      logger.warn('Admin login attempt with invalid password', { 
        email,
        adminId: adminUser.id 
      });
      throw new AuthenticationError('Invalid credentials');
    }
    
    // If TOTP is enabled, require a TOTP token in the same request
    if (adminUser.totp_enabled) {
      const { totp_token } = req.body;
      if (!totp_token) {
        // Return 401 so the client knows to prompt for a TOTP code.
        // Using 401 (not 200) avoids leaking that the password was correct
        // before the second factor is verified.
        //
        // Set res.locals.requiresTotp so the rate limiter's `skip` callback
        // doesn't count this protocol-step 401 against the per-IP attempt
        // budget - otherwise TOTP-enabled admins self-lock after 2-3 logins.
        res.locals.requiresTotp = true;
        return res.status(401).json({ requires_totp: true });
      }
      const totp = new TotpService();
      if (!totp.verifyToken(totp_token, adminUser.totp_secret)) {
        throw new AuthenticationError('Invalid 2FA token');
      }
    }

    // Lazy-migrate the bcrypt password onto compliance.staff as PBKDF2 so
    // the same credentials work on the AML console after this login.
    const staff = await upsertStaffFromLogin({
      email: adminUser.email,
      fullName: adminUser.email,
      password,
      kycRole: adminUser.role === 'admin' ? 'admin' : 'reviewer',
      kabilaAdminId: adminUser.id,
      bcryptHash: (adminUser as { password_hash?: string }).password_hash,
    });

    // Generate token
    const token = staff
      ? generateComplianceToken(staff)
      : generateAdminToken(adminUser);
    setAuthCookie(res, token, 24 * 60 * 60 * 1000);

    logger.info('Admin user logged in', {
      adminId: adminUser.id,
      email: adminUser.email,
      role: adminUser.role
    });

    res.json({
      token,
      user: {
        id: adminUser.id,
        email: adminUser.email,
        role: adminUser.role
      }
    });
  })
);

// ─── Unified staff login (combined console at /app/) ────────────────────────
//
// The combined console SPA posts to /api/auth/login (+ the WhatsApp variants
// below). These endpoints authenticate against compliance.staff first and
// fall back to the legacy Kabila admin_users table, lazily migrating that
// credential onto compliance.staff - same contract the Phase 3 rehearsal API
// exposed (see middleware/csrf.ts exclusions).

// GET /api/auth/me - hydrate the combined console from an existing
// kabila_token cookie or Bearer JWT so a push from verification
// to /app/screening does not bounce through login.
//
// Accepts EVERY console principal, not just staff. A developer-portal JWT
// (issuer kabila-api / audience kabila-developer) or a service-operator
// session previously 401'd here, which the combined SPA rendered as
// "not logged in" even though the developer endpoints accepted the cookie.
// Responses are tagged with `principal` so callers can tell them apart:
//   - staff            -> { principal: 'staff', user: {...} }   (unchanged shape)
//   - developer        -> { principal: 'developer', developer: {...} }
//   - service-operator -> { principal: 'service-operator' }
router.get('/me', catchAsync(async (req: Request, res: Response) => {
  const staff = await resolveStaff(req);
  if (staff) {
    return res.json({
      principal: 'staff',
      user: {
        id: staff.id,
        email: staff.email,
        full_name: staff.full_name,
        role: staff.role,
        aml_role: staff.aml_role,
        readonly: staff.readonly,
        scopes: staff.scopes,
      },
    });
  }

  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.kabila_token;

  // Developer portal session (same claims authenticateDashboard verifies).
  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret, {
        issuer: 'kabila-api',
        audience: 'kabila-developer',
      }) as { id?: string; type?: string };
      if (decoded.type === 'developer' && decoded.id) {
        const { data: developer } = await supabase
          .from('developers')
          .select('id, email, name, company, status, is_verified')
          .eq('id', decoded.id)
          .eq('is_verified', true)
          .single();
        if (developer && developer.status !== 'suspended') {
          return res.json({ principal: 'developer', developer });
        }
      }
    } catch { /* not a developer token - try service-operator */ }

    try {
      jwt.verify(token, config.jwtSecret, {
        issuer: 'kabila-api',
        audience: 'kabila-service-operator',
      });
      return res.json({ principal: 'service-operator' });
    } catch { /* not a service-operator token either */ }
  }

  throw new AuthenticationError('Unauthorized');
}));

function staffUserPayload(staff: StaffRow) {
  const role = staff.kyc_role === 'admin' ? 'admin' : 'reviewer';
  return {
    id: staff.id,
    email: staff.email,
    full_name: staff.full_name || staff.email,
    role,
    aml_role: staff.aml_role || (role === 'admin' ? 'superuser' : 'reviewer'),
    readonly: Boolean(staff.readonly),
    scopes: staff.scopes && staff.scopes.length ? staff.scopes : ['kyc', 'aml'],
  };
}

/**
 * TOTP gate for staff whose account is linked to a Kabila admin with 2FA
 * enabled. Returns true when a response has already been sent (the
 * protocol-step 401 asking for the code); throws on a wrong code.
 */
async function staffTotpGate(staff: StaffRow, totpToken: string | undefined, res: Response): Promise<boolean> {
  if (!staff.kabila_admin_id) return false;
  const { data: adminUser } = await supabase
    .from('admin_users')
    .select('totp_enabled, totp_secret')
    .eq('id', staff.kabila_admin_id)
    .single();
  if (!adminUser?.totp_enabled) return false;
  if (!totpToken) {
    res.locals.requiresTotp = true;
    res.status(401).json({ requires_totp: true });
    return true;
  }
  const totp = new TotpService();
  if (!totp.verifyToken(totpToken, adminUser.totp_secret)) {
    throw new AuthenticationError('Invalid 2FA token');
  }
  return false;
}

// POST /api/auth/login - unified staff email + password login
router.post('/login',
  adminLoginLimiter,
  [
    body('email')
      .isEmail()
      .withMessage('Valid email is required'),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { email, password, totp_token } = req.body;

    // 1. compliance.staff (canonical console operators)
    const staff = await findStaffByEmail(email);
    if (staff && staff.is_active && await verifyStaffPassword(password, staff)) {
      if (await staffTotpGate(staff, totp_token, res)) return;
      const token = generateComplianceToken(staff);
      await touchStaffSession(staff.id, token);
      setAuthCookie(res, token, 24 * 60 * 60 * 1000);
      logger.info('Staff logged in', { staffId: staff.id, email: staff.email });
      return res.json({ token, user: staffUserPayload(staff) });
    }

    // 2. Legacy Kabila admin fallback - mirrors /admin/login and lazily
    //    migrates the credential onto compliance.staff.
    const { data: adminUser, error } = await supabase
      .from('admin_users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !adminUser) {
      logger.warn('Staff login attempt with unknown email', { email });
      throw new AuthenticationError('Invalid credentials');
    }

    const isValidPassword = await bcrypt.compare(password, adminUser.password_hash);
    if (!isValidPassword) {
      logger.warn('Staff login attempt with invalid password', { email });
      throw new AuthenticationError('Invalid credentials');
    }

    if (adminUser.totp_enabled) {
      if (!totp_token) {
        res.locals.requiresTotp = true;
        return res.status(401).json({ requires_totp: true });
      }
      const totp = new TotpService();
      if (!totp.verifyToken(totp_token, adminUser.totp_secret)) {
        throw new AuthenticationError('Invalid 2FA token');
      }
    }

    const migrated = await upsertStaffFromLogin({
      email: adminUser.email,
      fullName: adminUser.email,
      password,
      kycRole: adminUser.role === 'admin' ? 'admin' : 'reviewer',
      kabilaAdminId: adminUser.id,
      bcryptHash: (adminUser as { password_hash?: string }).password_hash,
    });

    const token = migrated ? generateComplianceToken(migrated) : generateAdminToken(adminUser);
    if (migrated) await touchStaffSession(migrated.id, token);
    setAuthCookie(res, token, 24 * 60 * 60 * 1000);
    logger.info('Staff logged in via legacy admin credentials', { email: adminUser.email });

    return res.json({
      token,
      user: migrated ? staffUserPayload(migrated) : {
        id: adminUser.id,
        email: adminUser.email,
        full_name: adminUser.email,
        role: adminUser.role === 'admin' ? 'admin' : 'reviewer',
        aml_role: adminUser.role === 'admin' ? 'superuser' : 'reviewer',
        readonly: false,
        scopes: ['kyc', 'aml'],
      },
    });
  })
);

// POST /api/auth/login/whatsapp - send an OTP to a staff WhatsApp number
router.post('/login/whatsapp',
  otpSendLimiter,
  [
    body('phone_number')
      .isString()
      .isLength({ min: 10, max: 15 })
      .withMessage('Valid phone number is required'),
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const cleanPhone = String(req.body.phone_number).replace(/\s+/g, '');
    const generic = { message: 'If this number belongs to a staff account, a code has been sent.' };

    // Anti-enumeration: always answer with the generic message; only
    // actually mint + send an OTP when a matching active staff exists.
    const staff = await findStaffByWhatsapp(cleanPhone);
    if (!staff || !staff.is_active) {
      logger.warn('Staff WhatsApp OTP requested for unknown number', { phone_number: cleanPhone });
      return res.json(generic);
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const { error: otpError } = await supabase
      .from('phone_otp_codes')
      .insert({
        phone_number: cleanPhone,
        code: otp,
        expires_at: expiresAt.toISOString(),
      });

    if (otpError) {
      logger.error('Failed to store staff WhatsApp OTP', { error: otpError });
      throw new Error('Failed to generate OTP');
    }

    try {
      const response = await fetch(`${config.whatsapp.serviceUrl}/api/send-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.whatsapp.apiKey,
        },
        body: JSON.stringify({ phone_number: cleanPhone, otp }),
      });
      if (!response.ok) {
        logger.error('WhatsApp service failed for staff OTP', { status: response.status });
      }
    } catch (error) {
      logger.error('WhatsApp service error for staff OTP', { error });
    }

    logger.info('Staff WhatsApp OTP sent', { staffId: staff.id, phone_number: cleanPhone });
    res.json({
      ...generic,
      // Include OTP in response for self-hosted testing outside production
      ...(process.env.NODE_ENV !== 'production' && { otp }),
    });
  })
);

// POST /api/auth/login/whatsapp/verify - verify staff OTP and issue session
router.post('/login/whatsapp/verify',
  otpVerifyLimiter,
  [
    body('phone_number')
      .isString()
      .isLength({ min: 10, max: 15 })
      .withMessage('Valid phone number is required'),
    body('otp_code')
      .isString()
      .isLength({ min: 6, max: 6 })
      .isNumeric()
      .withMessage('6-digit numeric code is required'),
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { phone_number, otp_code, totp_token } = req.body;
    const cleanPhone = String(phone_number).replace(/\s+/g, '');

    const { data: otpRecord, error: otpError } = await supabase
      .from('phone_otp_codes')
      .select('*')
      .eq('phone_number', cleanPhone)
      .eq('code', otp_code)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (otpError || !otpRecord) {
      logger.warn('Invalid staff WhatsApp OTP attempt', { phone_number: cleanPhone });
      throw new AuthenticationError('Invalid or expired OTP code');
    }

    await supabase
      .from('phone_otp_codes')
      .update({ used: true })
      .eq('id', otpRecord.id);

    const staff = await findStaffByWhatsapp(cleanPhone);
    if (!staff || !staff.is_active) {
      throw new AuthenticationError('No staff account is linked to this number');
    }

    if (await staffTotpGate(staff, totp_token, res)) return;

    const token = generateComplianceToken(staff);
    await touchStaffSession(staff.id, token);
    setAuthCookie(res, token, 24 * 60 * 60 * 1000);
    logger.info('Staff logged in via WhatsApp OTP', { staffId: staff.id, phone_number: cleanPhone });

    res.json({ token, user: staffUserPayload(staff) });
  })
);

// Developer escalation removed - developers now invite org admins from Settings
router.post('/admin/escalate', (_req: Request, res: Response) => {
  res.status(410).json({
    message: 'Developer escalation removed. Invite organization admins from Settings.',
  });
});

// Shared email validation
const emailValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
];

// ─── OTP Flow ──────────────────────────────────────────────────────────────────

// POST /api/auth/developer/otp/send - send a 6-digit code to the email
router.post('/developer/otp/send',
  otpSendLimiter,
  emailValidation,
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { email } = req.body;

    // Always return success to prevent email enumeration
    const result = await createAndSendOtp(email);

    // Self-hosted: include the code in response when no email transport is configured
    res.json({
      message: 'If this email is valid, a verification code has been sent.',
      ...(result.code && { code: result.code, self_hosted: true }),
    });
  })
);

// POST /api/auth/developer/otp/verify - verify the 6-digit code
router.post('/developer/otp/verify',
  otpVerifyLimiter,
  [
    ...emailValidation,
    body('code')
      .isString()
      .isLength({ min: 6, max: 6 })
      .isNumeric()
      .withMessage('6-digit numeric code is required'),
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { email, code } = req.body;
    const result = await verifyOtp(email, code);

    if (!result.valid) {
      throw new AuthenticationError(result.reason || 'Invalid code');
    }

    // Check if this email belongs to an existing developer
    const { data: developer } = await supabase
      .from('developers')
      .select('*')
      .eq('email', email)
      .eq('is_verified', true)
      .single();

    if (developer) {
      // Existing developer - issue a session token
      const token = generateDeveloperToken(developer);
      setAuthCookie(res, token);
      logger.info('Developer logged in via OTP', { developerId: developer.id, email });

      return res.json({
        token,
        developer: {
          id: developer.id,
          email: developer.email,
          name: developer.name,
          company: developer.company,
          is_verified: developer.is_verified,
          created_at: developer.created_at,
        },
        is_new: false,
      });
    }

    // New email - issue a short-lived registration token
    const registrationToken = generateRegistrationToken(email);
    logger.info('New developer OTP verified, registration token issued', { email });

    res.json({
      registration_token: registrationToken,
      is_new: true,
    });
  })
);

// POST /api/auth/developer/otp/complete-registration - create account after OTP
router.post('/developer/otp/complete-registration',
  [
    body('registration_token').isString().notEmpty().withMessage('Registration token is required'),
    body('name').isString().trim().isLength({ min: 1 }).withMessage('Name is required'),
    body('company').optional().isString().trim(),
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { registration_token, name, company } = req.body;

    // Verify the registration token
    let email: string;
    try {
      email = verifyRegistrationToken(registration_token);
    } catch {
      throw new AuthenticationError('Registration token is invalid or expired. Please start over.');
    }

    // Check if account was already created (race condition guard)
    const { data: existing } = await supabase
      .from('developers')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      throw new ValidationError('An account with this email already exists', 'email', email);
    }

    // Create developer
    const { data: developer, error: createError } = await supabase
      .from('developers')
      .insert({ email, name, company: company || null, is_verified: true })
      .select('*')
      .single();

    if (createError) {
      if (createError.code === '23505') {
        throw new ValidationError('An account with this email already exists', 'email', email);
      }
      logger.error('Developer creation failed', { error: createError });
      throw new Error('Failed to create developer account');
    }

    // Create initial API key
    const { key, hash, prefix } = generateAPIKey();
    const isProductionEnv = process.env.NODE_ENV === 'production';

    const { data: apiKey, error: keyError } = await supabase
      .from('api_keys')
      .insert({
        developer_id: developer.id,
        key_hash: hash,
        key_prefix: prefix,
        name: 'Default API Key',
        is_sandbox: !isProductionEnv,
      })
      .select('id, name, is_sandbox, created_at')
      .single();

    // Generate session token
    const token = generateDeveloperToken(developer);
    setAuthCookie(res, token);

    logger.info('New developer registered via OTP', {
      developerId: developer.id,
      email,
      apiKeyId: apiKey?.id,
    });

    res.status(201).json({
      token,
      developer: {
        id: developer.id,
        email: developer.email,
        name: developer.name,
        company: developer.company,
        is_verified: developer.is_verified,
        created_at: developer.created_at,
      },
      api_key: apiKey && !keyError ? {
        key,
        id: apiKey.id,
        name: apiKey.name,
        is_sandbox: apiKey.is_sandbox,
        created_at: apiKey.created_at,
      } : undefined,
      is_new: true,
    });
  })
);

// ─── Reviewer OTP Flow ────────────────────────────────────────────────────────

// POST /api/auth/reviewer/otp/send - send OTP to a reviewer's email
router.post('/reviewer/otp/send',
  otpSendLimiter,
  emailValidation,
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { email } = req.body;

    // Check email exists in verification_reviewers and is not revoked
    const { data: reviewer } = await supabase
      .from('verification_reviewers')
      .select('id')
      .eq('email', email)
      .neq('status', 'revoked')
      .limit(1)
      .single();

    // Always return success to prevent email enumeration
    if (!reviewer) {
      return res.json({
        message: 'If this email is registered as a reviewer, a verification code has been sent.',
      });
    }

    const result = await createAndSendOtp(email);

    res.json({
      message: 'If this email is registered as a reviewer, a verification code has been sent.',
      ...(result.code && { code: result.code, self_hosted: true }),
    });
  })
);

// POST /api/auth/reviewer/otp/verify - verify OTP and issue reviewer JWT
router.post('/reviewer/otp/verify',
  otpVerifyLimiter,
  [
    ...emailValidation,
    body('code')
      .isString()
      .isLength({ min: 6, max: 6 })
      .isNumeric()
      .withMessage('6-digit numeric code is required'),
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { email, code } = req.body;
    const result = await verifyOtp(email, code);

    if (!result.valid) {
      throw new AuthenticationError(result.reason || 'Invalid code');
    }

    // Look up reviewer - must not be revoked
    const { data: reviewer, error } = await supabase
      .from('verification_reviewers')
      .select('*')
      .eq('email', email)
      .neq('status', 'revoked')
      .limit(1)
      .single();

    if (error || !reviewer) {
      throw new AuthenticationError('No active reviewer account found for this email');
    }

    // Update status to active + last_login_at
    await supabase
      .from('verification_reviewers')
      .update({ status: 'active', last_login_at: new Date().toISOString() })
      .eq('id', reviewer.id);

    const token = generateReviewerToken({
      id: reviewer.id,
      email: reviewer.email,
      developer_id: reviewer.developer_id,
      role: reviewer.role,
    });
    setAuthCookie(res, token, 24 * 60 * 60 * 1000);

    logger.info('Reviewer logged in via OTP', { reviewerId: reviewer.id, email, role: reviewer.role });

    res.json({
      token,
      reviewer: {
        id: reviewer.id,
        email: reviewer.email,
        name: reviewer.name,
        developer_id: reviewer.developer_id,
        role: reviewer.role || 'reviewer',
      },
    });
  })
);

// ─── GitHub OAuth ──────────────────────────────────────────────────────────────

const OAUTH_STATE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Generate an HMAC-signed OAuth state that is self-verifiable without server-side storage.
 * Format: `timestamp.random.hmac` - survives server restarts and multi-instance deploys.
 */
function generateOAuthState(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(16).toString('hex');
  const payload = `${timestamp}.${random}`;
  const hmac = crypto.createHmac('sha256', config.jwtSecret).update(payload).digest('hex').slice(0, 16);
  return `${payload}.${hmac}`;
}

function verifyOAuthState(state: string): boolean {
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [timestamp, random, hmac] = parts;
  // Verify HMAC
  const payload = `${timestamp}.${random}`;
  const expectedHmac = crypto.createHmac('sha256', config.jwtSecret).update(payload).digest('hex').slice(0, 16);
  if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))) return false;
  // Verify TTL
  const createdAt = parseInt(timestamp, 36);
  if (Date.now() - createdAt > OAUTH_STATE_TTL) return false;
  return true;
}

// POST /api/auth/developer/github/callback - exchange GitHub code for session
router.post('/developer/github/callback',
  [
    body('code').isString().matches(/^[a-zA-Z0-9_\-]{10,256}$/).withMessage('Invalid GitHub authorization code'),
    body('state').isString().notEmpty().withMessage('OAuth state parameter is required'),
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    if (!config.github.clientId || !config.github.clientSecret) {
      throw new AuthenticationError('GitHub authentication is not configured');
    }

    // Validate OAuth state (CSRF protection - HMAC-signed, no server storage needed)
    const { code, state } = req.body;
    if (!verifyOAuthState(state)) {
      throw new AuthenticationError('Invalid or expired OAuth state');
    }

    // Exchange code for access token
    const accessToken = await githubOAuth.exchangeCodeForToken(code);

    // Fetch GitHub profile + emails
    const ghUser = await githubOAuth.getGitHubUser(accessToken);

    // Verify email is present (getGitHubUser throws if not, but guard explicitly)
    if (!ghUser.email) {
      throw new AuthenticationError('No verified email found on your GitHub account');
    }

    // Normalize GitHub email to match express-validator's normalizeEmail() behaviour
    ghUser.email = ghUser.email.toLowerCase().trim();

    // Try to find developer by github_id first, then by email
    let developer: Developer | null = null;
    let isNew = false;

    const { data: byGithubId } = await supabase
      .from('developers')
      .select('*')
      .eq('github_id', ghUser.id)
      .single();

    if (byGithubId) {
      developer = byGithubId as Developer;
      // Update avatar if changed
      if (ghUser.avatar_url && ghUser.avatar_url !== developer.avatar_url) {
        await supabase.from('developers').update({ avatar_url: ghUser.avatar_url }).eq('id', developer.id);
      }
    } else {
      // Try by email
      const { data: byEmail } = await supabase
        .from('developers')
        .select('*')
        .eq('email', ghUser.email)
        .eq('is_verified', true)
        .single();

      if (byEmail) {
        // Link GitHub to existing account
        developer = byEmail as Developer;
        await supabase.from('developers')
          .update({ github_id: ghUser.id, avatar_url: ghUser.avatar_url })
          .eq('id', developer.id);
      } else {
        // Auto-register new developer via GitHub
        const { data: newDev, error: createError } = await supabase
          .from('developers')
          .insert({
            email: ghUser.email,
            name: ghUser.name || ghUser.login,
            company: ghUser.company || null,
            github_id: ghUser.id,
            avatar_url: ghUser.avatar_url,
            is_verified: true,
          })
          .select('*')
          .single();

        if (createError) {
          // Handle race condition: another request created the account concurrently
          if (createError.code === '23505') {
            const { data: existing } = await supabase
              .from('developers')
              .select('*')
              .eq('email', ghUser.email)
              .single();
            if (existing) {
              developer = existing as Developer;
              await supabase.from('developers')
                .update({ github_id: ghUser.id, avatar_url: ghUser.avatar_url })
                .eq('id', developer.id);
              // Fall through to existing-developer login below
            } else {
              throw new Error('Failed to create developer account');
            }
          } else {
            logger.error('GitHub auto-registration failed', { error: createError });
            throw new Error('Failed to create developer account');
          }
        } else if (newDev) {
          developer = newDev as Developer;
          isNew = true;

          // Create initial API key for new GitHub users
          const { key, hash, prefix } = generateAPIKey();
          const isProductionEnv = process.env.NODE_ENV === 'production';

          const { data: apiKey } = await supabase
            .from('api_keys')
            .insert({
              developer_id: developer.id,
              key_hash: hash,
              key_prefix: prefix,
              name: 'Default API Key',
              is_sandbox: !isProductionEnv,
            })
            .select('id, name, is_sandbox, created_at')
            .single();

          logger.info('New developer registered via GitHub', {
            developerId: developer.id,
            email: ghUser.email,
            githubId: ghUser.id,
            apiKeyId: apiKey?.id,
          });

          const token = generateDeveloperToken(developer);
          setAuthCookie(res, token);
          return res.status(201).json({
            token,
            developer: {
              id: developer.id,
              email: developer.email,
              name: developer.name,
              company: developer.company,
              is_verified: developer.is_verified,
              avatar_url: resolvePublicAssetUrl(developer.avatar_url),
              created_at: developer.created_at,
            },
            api_key: apiKey ? { key, id: apiKey.id, name: apiKey.name, is_sandbox: apiKey.is_sandbox, created_at: apiKey.created_at } : undefined,
            is_new: true,
          });
        }
      }
    }

    // Existing developer login
    if (!developer) {
      throw new Error('Failed to resolve developer account');
    }
    const token = generateDeveloperToken(developer);
    setAuthCookie(res, token);
    logger.info('Developer logged in via GitHub', { developerId: developer.id, githubId: ghUser.id });

    res.json({
      token,
      developer: {
        id: developer.id,
        email: developer.email,
        name: developer.name,
        company: developer.company,
        is_verified: developer.is_verified,
        avatar_url: resolvePublicAssetUrl(developer.avatar_url),
        created_at: developer.created_at,
      },
      is_new: isNew,
    });
  })
);

// ─── WhatsApp OTP Flow ───────────────────────────────────────────────────────────

// POST /api/auth/whatsapp/send-otp - send OTP via WhatsApp service
router.post('/whatsapp/send-otp',
  otpSendLimiter,
  [
    body('phone_number')
      .isString()
      .isLength({ min: 10, max: 15 })
      .withMessage('Valid phone number is required'),
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { phone_number } = req.body;

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP in database (or cache)
    const { error: otpError } = await supabase
      .from('phone_otp_codes')
      .insert({
        phone_number: phone_number.replace(/\s+/g, ''),
        code: otp,
        expires_at: expiresAt.toISOString(),
      });

    if (otpError) {
      logger.error('Failed to store WhatsApp OTP', { error: otpError });
      throw new Error('Failed to generate OTP');
    }

    // Send OTP via Daraja WhatsApp service
    try {
      const response = await fetch(`${config.whatsapp.serviceUrl}/api/send-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.whatsapp.apiKey,
        },
        body: JSON.stringify({
          phone_number,
          otp,
        }),
      });

      if (!response.ok) {
        logger.error('WhatsApp service failed', { status: response.status });
        // Continue anyway - OTP is stored for testing
      }
    } catch (error) {
      logger.error('WhatsApp service error', { error });
      // Continue anyway - OTP is stored for testing
    }

    logger.info('WhatsApp OTP sent', { phone_number });

    res.json({
      message: 'OTP sent successfully',
      // Include OTP in response for self-hosted testing
      ...(process.env.NODE_ENV !== 'production' && { otp }),
    });
  })
);

// POST /api/auth/whatsapp/verify-otp - verify OTP and issue session
router.post('/whatsapp/verify-otp',
  otpVerifyLimiter,
  [
    body('phone_number')
      .isString()
      .isLength({ min: 10, max: 15 })
      .withMessage('Valid phone number is required'),
    body('otp_code')
      .isString()
      .isLength({ min: 6, max: 6 })
      .isNumeric()
      .withMessage('6-digit numeric code is required'),
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { phone_number, otp_code } = req.body;
    const cleanPhone = phone_number.replace(/\s+/g, '');

    // Check OTP in database
    const { data: otpRecord, error: otpError } = await supabase
      .from('phone_otp_codes')
      .select('*')
      .eq('phone_number', cleanPhone)
      .eq('code', otp_code)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (otpError || !otpRecord) {
      logger.warn('Invalid WhatsApp OTP attempt', { phone_number: cleanPhone });
      throw new AuthenticationError('Invalid or expired OTP code');
    }

    // Mark OTP as used
    await supabase
      .from('phone_otp_codes')
      .update({ used: true })
      .eq('id', otpRecord.id);

    // Check if user exists with this phone number
    const { data: developer } = await supabase
      .from('developers')
      .select('*')
      .eq('phone_number', cleanPhone)
      .eq('is_verified', true)
      .single();

    if (developer) {
      // Existing user - issue session token
      const token = generateDeveloperToken(developer);
      setAuthCookie(res, token);
      logger.info('Developer logged in via WhatsApp OTP', { developerId: developer.id, phone_number: cleanPhone });

      return res.json({
        token,
        developer: {
          id: developer.id,
          email: developer.email,
          name: developer.name,
          company: developer.company,
          is_verified: developer.is_verified,
          created_at: developer.created_at,
        },
        is_new: false,
      });
    }

    // New phone number - issue registration token
    const registrationToken = generateRegistrationToken(cleanPhone);
    logger.info('New WhatsApp OTP verified, registration token issued', { phone_number: cleanPhone });

    res.json({
      registration_token: registrationToken,
      phone_number: cleanPhone,
      is_new: true,
    });
  })
);

// POST /api/auth/whatsapp/complete-registration - create account after WhatsApp OTP
router.post('/whatsapp/complete-registration',
  [
    body('registration_token').isString().notEmpty().withMessage('Registration token is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('name').isString().trim().isLength({ min: 1 }).withMessage('Name is required'),
    body('company').optional().isString().trim(),
  ],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { registration_token, email, name, company, phone_number } = req.body;

    // Verify the registration token contains phone number
    let phoneNumber: string;
    try {
      phoneNumber = verifyRegistrationToken(registration_token);
    } catch {
      throw new AuthenticationError('Registration token is invalid or expired. Please start over.');
    }

    // Check if account was already created
    const { data: existing } = await supabase
      .from('developers')
      .select('id')
      .eq('phone_number', phoneNumber)
      .single();

    if (existing) {
      throw new ValidationError('An account with this phone number already exists', 'phone_number', phoneNumber);
    }

    // Create developer
    const { data: developer, error: createError } = await supabase
      .from('developers')
      .insert({
        email,
        name,
        company: company || null,
        phone_number: phoneNumber,
        is_verified: true,
      })
      .select('*')
      .single();

    if (createError) {
      if (createError.code === '23505') {
        throw new ValidationError('An account with this email already exists', 'email', email);
      }
      logger.error('Developer creation failed', { error: createError });
      throw new Error('Failed to create developer account');
    }

    // Create initial API key
    const { key, hash, prefix } = generateAPIKey();
    const isProductionEnv = process.env.NODE_ENV === 'production';

    const { data: apiKey, error: keyError } = await supabase
      .from('api_keys')
      .insert({
        developer_id: developer.id,
        key_hash: hash,
        key_prefix: prefix,
        name: 'Default API Key',
        is_sandbox: !isProductionEnv,
      })
      .select('id, name, is_sandbox, created_at')
      .single();

    // Generate session token
    const token = generateDeveloperToken(developer);
    setAuthCookie(res, token);

    logger.info('New developer registered via WhatsApp', {
      developerId: developer.id,
      email,
      phoneNumber,
      apiKeyId: apiKey?.id,
    });

    res.status(201).json({
      token,
      developer: {
        id: developer.id,
        email: developer.email,
        name: developer.name,
        company: developer.company,
        phone_number: developer.phone_number,
        is_verified: developer.is_verified,
        created_at: developer.created_at,
      },
      api_key: apiKey && !keyError ? {
        key,
        id: apiKey.id,
        name: apiKey.name,
        is_sandbox: apiKey.is_sandbox,
        created_at: apiKey.created_at,
      } : undefined,
      is_new: true,
    });
  })
);

// GET /api/auth/developer/github/url - return the GitHub OAuth URL
router.get('/developer/github/url',
  catchAsync(async (req: Request, res: Response) => {
    if (!config.github.clientId) {
      return res.json({ url: null, configured: false });
    }

    // Generate HMAC-signed state (self-verifiable, no server storage needed)
    const state = generateOAuthState();

    const url = githubOAuth.getAuthorizationUrl(state);
    res.json({ url, state, configured: true });
  })
);

// POST /api/auth/totp/setup - generate and store TOTP secret, return QR code
router.post('/totp/setup',
  authenticateJWT,
  catchAsync(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const totp = new TotpService();
    const secret = totp.generateSecret();
    const qrCode = await totp.generateQrCode(user.email, secret);

    // Store the unverified secret; totp_enabled stays false until /totp/verify succeeds
    await supabase.from('admin_users')
      .update({ totp_secret: secret, totp_enabled: false })
      .eq('id', user.id);

    res.json({ qrCode });
  })
);

// POST /api/auth/totp/verify - verify first token, enable TOTP for this account
router.post('/totp/verify',
  authenticateJWT,
  catchAsync(async (req: Request, res: Response) => {
    const { token } = req.body;
    const user = (req as any).user;

    const { data: admin } = await supabase.from('admin_users')
      .select('totp_secret')
      .eq('id', user.id)
      .single();

    if (!admin?.totp_secret) {
      throw new ValidationError('TOTP setup not started', 'token', token);
    }

    const totp = new TotpService();
    if (!totp.verifyToken(token, admin.totp_secret)) {
      throw new ValidationError('Invalid TOTP token', 'token', token);
    }

    await supabase.from('admin_users')
      .update({ totp_enabled: true, totp_verified_at: new Date().toISOString() })
      .eq('id', user.id);

    res.json({ message: '2FA enabled successfully' });
  })
);

export default router;