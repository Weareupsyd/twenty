/**
 * Phase 1 - compliance.staff helpers.
 *
 * public.users is KYC subjects. Console operators live in compliance.staff.
 * Lookups no-op (return null) when the schema has not been applied yet.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { supabase } from '@/config/database.js';
import { logger } from '@/utils/logger.js';

export type StaffRow = {
  id: string;
  email: string;
  full_name: string;
  hashed_password: string | null;
  bcrypt_hash: string | null;
  whatsapp_number: string | null;
  aml_role: string;
  kyc_role: 'admin' | 'reviewer';
  readonly: boolean;
  is_active: boolean;
  scopes: string[];
  session_token: string | null;
  aml_user_id: string | null;
  kabila_admin_id: string | null;
};

const PBKDF2_ITERS = 100000;
const PBKDF2_KEYLEN = 32;

export function hashPbkdf2(password: string): string {
  const salt = crypto.randomBytes(16);
  const digest = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERS, PBKDF2_KEYLEN, 'sha256');
  return `${salt.toString('hex')}$${digest.toString('hex')}`;
}

export function verifyPbkdf2(password: string, stored: string): boolean {
  const sep = stored.indexOf('$');
  if (sep < 1) return false;
  const saltHex = stored.slice(0, sep);
  const hashHex = stored.slice(sep + 1);
  try {
    const actual = crypto.pbkdf2Sync(
      password,
      Buffer.from(saltHex, 'hex'),
      PBKDF2_ITERS,
      Buffer.from(hashHex, 'hex').length,
      'sha256',
    );
    const expected = Buffer.from(hashHex, 'hex');
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export async function verifyStaffPassword(password: string, staff: StaffRow): Promise<boolean> {
  if (staff.hashed_password && verifyPbkdf2(password, staff.hashed_password)) {
    return true;
  }
  if (staff.bcrypt_hash && staff.bcrypt_hash.startsWith('$2')) {
    return bcrypt.compare(password, staff.bcrypt_hash);
  }
  return false;
}

export async function findStaffById(id: string): Promise<StaffRow | null> {
  try {
    const { data, error } = await supabase.from('staff').select('*').eq('id', id).single();
    if (error || !data) return null;
    return data as StaffRow;
  } catch (err) {
    logger.debug('compliance.staff id lookup skipped', { err });
    return null;
  }
}

export async function findStaffByWhatsapp(phone: string): Promise<StaffRow | null> {
  const cleaned = phone.replace(/\s+/g, '');
  try {
    const { data, error } = await supabase
      .from('staff')
      .select('*')
      .eq('whatsapp_number', cleaned)
      .single();
    if (error || !data) return null;
    return data as StaffRow;
  } catch (err) {
    logger.debug('compliance.staff whatsapp lookup skipped', { err });
    return null;
  }
}

export async function touchStaffSession(staffId: string, token: string): Promise<void> {
  try {
    await supabase
      .from('staff')
      .update({ session_token: token, session_last_active: new Date().toISOString() })
      .eq('id', staffId);
  } catch (err) {
    logger.debug('compliance.staff session touch skipped', { err });
  }
}

export async function findStaffByEmail(email: string): Promise<StaffRow | null> {
  try {
    const { data, error } = await supabase
      .from('staff')
      .select('*')
      .eq('email', email.trim().toLowerCase())
      .single();
    if (error || !data) return null;
    return data as StaffRow;
  } catch (err) {
    logger.debug('compliance.staff lookup skipped', { err });
    return null;
  }
}

/**
 * Seed the bootstrap staff admin from ADMIN_EMAIL / ADMIN_PASSWORD.
 *
 * The decommissioned Python AML service used to create this account; the
 * combined stack must do it itself or a fresh install has no way to log in
 * to the console at /app/. Idempotent:
 *   - creates the account when the email does not exist yet;
 *   - keeps the stored hash in lock-step with ADMIN_PASSWORD so the value
 *     printed by show-credentials.sh / up.sh always signs in;
 *   - re-activates the row if it was disabled.
 *
 * ADMIN_PASSWORD in the stack .env is the source of truth for this one
 * bootstrap email. Other staff accounts are never touched.
 */
export async function seedBootstrapStaff(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const fullName = process.env.ADMIN_FULL_NAME || 'System Administrator';
  if (!email || !password) {
    logger.debug('Bootstrap staff seed skipped (ADMIN_EMAIL / ADMIN_PASSWORD not set)');
    return;
  }
  try {
    const existing = await findStaffByEmail(email);
    if (existing) {
      const matches = await verifyStaffPassword(password, existing);
      if (matches && existing.is_active) {
        return;
      }
      await supabase
        .from('staff')
        .update({
          hashed_password: hashPbkdf2(password),
          full_name: existing.full_name || fullName,
          kyc_role: 'admin',
          aml_role: existing.aml_role || 'superuser',
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      logger.info('Bootstrap staff password synced from ADMIN_PASSWORD', { email });
      return;
    }
    const { error } = await supabase.from('staff').insert({
      email,
      full_name: fullName,
      hashed_password: hashPbkdf2(password),
      kyc_role: 'admin',
      aml_role: 'superuser',
      is_active: true,
      scopes: ['kyc', 'aml'],
    });
    if (error) {
      logger.warn('Bootstrap staff seed failed', { error });
      return;
    }
    logger.info('Bootstrap staff admin seeded', { email });
  } catch (err) {
    logger.warn('Bootstrap staff seed skipped', { err });
  }
}

export async function upsertStaffFromLogin(opts: {
  email: string;
  fullName: string;
  password: string;
  kycRole: 'admin' | 'reviewer';
  amlRole?: string;
  kabilaAdminId?: string;
  bcryptHash?: string;
}): Promise<StaffRow | null> {
  const email = opts.email.trim().toLowerCase();
  const existing = await findStaffByEmail(email);
  const pbkdf2 = hashPbkdf2(opts.password);
  const row = {
    email,
    full_name: opts.fullName,
    hashed_password: pbkdf2,
    bcrypt_hash: opts.bcryptHash ?? existing?.bcrypt_hash ?? null,
    kyc_role: opts.kycRole,
    aml_role: opts.amlRole ?? existing?.aml_role ?? (opts.kycRole === 'admin' ? 'superuser' : 'reviewer'),
    is_active: true,
    kabila_admin_id: opts.kabilaAdminId ?? existing?.kabila_admin_id ?? null,
    updated_at: new Date().toISOString(),
  };
  try {
    if (existing) {
      const { data, error } = await supabase.from('staff').update(row).eq('id', existing.id).select('*').single();
      if (error) return existing;
      return data as StaffRow;
    }
    const { data, error } = await supabase
      .from('staff')
      .insert({ ...row, scopes: ['kyc', 'aml'] })
      .select('*')
      .single();
    if (error) {
      logger.debug('compliance.staff insert skipped', { error });
      return null;
    }
    return data as StaffRow;
  } catch (err) {
    logger.debug('compliance.staff upsert skipped', { err });
    return null;
  }
}
