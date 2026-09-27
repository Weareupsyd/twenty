import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import config from '@/config/index.js';
import { findStaffByEmail, findStaffById } from '@/services/staffService.js';

export type StaffPrincipal = {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'reviewer';
  aml_role: string;
  readonly: boolean;
  scopes: string[];
};

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = (req as Request & { cookies?: { kabila_token?: string } }).cookies?.kabila_token;
  if (cookie) return cookie;
  const session = req.headers['x-session-token'];
  if (typeof session === 'string' && session) return session;
  return null;
}

export async function resolveStaff(req: Request): Promise<StaffPrincipal | null> {
  const token = readToken(req);
  if (!token) return null;
  let decoded: {
    id?: string;
    email?: string;
    role?: string;
    aml_role?: string;
    type?: string;
    scope?: string[];
    readonly?: boolean;
  };
  try {
    decoded = jwt.verify(token, config.jwtSecret, {
      issuer: 'compliance',
      audience: 'compliance',
    }) as typeof decoded;
  } catch {
    try {
      decoded = jwt.verify(token, config.jwtSecret, {
        issuer: 'kabila-api',
        audience: 'kabila-admin',
      }) as typeof decoded;
    } catch {
      return null;
    }
  }

  if (decoded.id) {
    const staff = await findStaffById(decoded.id);
    if (staff?.is_active) {
      return {
        id: staff.id,
        email: staff.email,
        full_name: staff.full_name || staff.email,
        role: staff.kyc_role === 'admin' ? 'admin' : 'reviewer',
        aml_role: staff.aml_role,
        readonly: staff.readonly,
        scopes: staff.scopes || ['kyc', 'aml'],
      };
    }
  }
  if (decoded.email) {
    const staff = await findStaffByEmail(decoded.email);
    if (staff?.is_active) {
      return {
        id: staff.id,
        email: staff.email,
        full_name: staff.full_name || staff.email,
        role: staff.kyc_role === 'admin' ? 'admin' : 'reviewer',
        aml_role: staff.aml_role,
        readonly: staff.readonly,
        scopes: staff.scopes || ['kyc', 'aml'],
      };
    }
  }
  if (decoded.email) {
    return {
      id: decoded.id || decoded.email,
      email: decoded.email,
      full_name: decoded.email,
      role: decoded.role === 'admin' ? 'admin' : 'reviewer',
      aml_role: decoded.aml_role || (decoded.role === 'admin' ? 'superuser' : 'reviewer'),
      readonly: Boolean(decoded.readonly),
      scopes: decoded.scope || ['kyc', 'aml'],
    };
  }
  return null;
}

export async function requireStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const staff = await resolveStaff(req);
    if (!staff) {
      res.status(401).json({ error: 'Unauthorized', message: 'Compliance staff token required' });
      return;
    }
    (req as Request & { staff?: StaffPrincipal }).staff = staff;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireWritable(req: Request, res: Response, next: NextFunction): void {
  const staff = (req as Request & { staff?: StaffPrincipal }).staff;
  if (staff?.readonly) {
    res.status(403).json({ error: 'Forbidden', message: 'Auditor accounts are read-only' });
    return;
  }
  next();
}

export function staffFrom(req: Request): StaffPrincipal {
  const staff = (req as Request & { staff?: StaffPrincipal }).staff;
  if (!staff) {
    throw Object.assign(new Error('Staff principal missing'), { status: 401 });
  }
  return staff;
}
