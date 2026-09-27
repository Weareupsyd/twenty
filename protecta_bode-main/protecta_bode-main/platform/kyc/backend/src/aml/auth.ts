import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import config from '@/config/index.js';
import { amlConfig } from './config.js';

export type AmlAuth = {
  kind: 'aml-key' | 'aml-admin-key' | 'staff' | 'kabila-key';
  admin: boolean;
  email?: string;
};

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const session = req.headers['x-session-token'];
  if (typeof session === 'string' && session) return session;
  const cookie = (req as Request & { cookies?: { kabila_token?: string } }).cookies?.kabila_token;
  if (cookie) return cookie;
  return null;
}

const STAFF_VERIFY = [
  { issuer: 'compliance', audience: 'compliance' },
  { issuer: 'kabila-api', audience: 'kabila-admin' },
] as const;

export function resolveAmlAuth(req: Request): AmlAuth | null {
  const key = req.headers['x-api-key'];
  if (typeof key === 'string' && key) {
    if (amlConfig.apiKeyAdmin && key === amlConfig.apiKeyAdmin) {
      return { kind: 'aml-admin-key', admin: true };
    }
    if (amlConfig.apiKeyRead && key === amlConfig.apiKeyRead) {
      return { kind: 'aml-key', admin: false };
    }
  }

  const token = readToken(req);
  if (token && token.includes('.')) {
    for (const opts of STAFF_VERIFY) {
      try {
        const decoded = jwt.verify(token, config.jwtSecret, opts) as {
          email?: string; role?: string; type?: string;
        };
        if (decoded.type === 'staff' || decoded.email || decoded.role) {
          return {
            kind: 'staff',
            admin: decoded.role === 'admin',
            email: decoded.email,
          };
        }
      } catch {
        // try the next issuer/audience pair
      }
    }
  }
  return null;
}

export function requireAmlAccess(req: Request, res: Response, next: NextFunction): void {
  const auth = resolveAmlAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'Unauthorized', message: 'API key or compliance token required' });
    return;
  }
  (req as Request & { amlAuth?: AmlAuth }).amlAuth = auth;
  next();
}

export function requireAmlAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = resolveAmlAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!auth.admin) {
    res.status(403).json({ error: 'Forbidden', message: 'Admin API key or admin staff role required' });
    return;
  }
  (req as Request & { amlAuth?: AmlAuth }).amlAuth = auth;
  next();
}
