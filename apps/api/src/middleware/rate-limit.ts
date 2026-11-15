// 300 requests/min per user, of which at most 60 writes/min (contracts/rest-api.md). Runs before
// authentication, so the key is the token's unverified `sub` (falling back to the IP); a forged sub
// can only spend that user's own budget, and verification still happens in the auth middleware.
import type { Request, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from './error';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function userKey(req: Request): string {
  const token = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '')?.[1];
  const payload = token?.split('.')[1];
  if (payload) {
    try {
      const sub = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).sub;
      if (typeof sub === 'string') return `user:${sub}`;
    } catch {
      // fall through to the IP
    }
  }
  return `ip:${req.ip ?? 'unknown'}`;
}

const handler: RequestHandler = (_req, _res, next) => {
  next(new AppError('RATE_LIMITED', 'Too many requests'));
};

export function rateLimits(options: { perMinute?: number; writesPerMinute?: number } = {}) {
  const all = rateLimit({
    windowMs: 60_000,
    limit: options.perMinute ?? 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: userKey,
    handler,
  });
  const writes = rateLimit({
    windowMs: 60_000,
    limit: options.writesPerMinute ?? 60,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => `w:${userKey(req)}`,
    skip: (req) => READ_METHODS.has(req.method),
    handler,
  });
  return [all, writes];
}
