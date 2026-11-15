import type { Permission } from '@ngo/shared';
import type { RequestHandler } from 'express';
import { AppError } from './error';

/** 403 unless the caller's roles grant `code` in the current tenant. */
export function requirePermission(code: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.ctx) {
      next(new AppError('FORBIDDEN', 'No tenant context'));
      return;
    }
    if (!req.ctx.permissions.has(code)) {
      next(new AppError('FORBIDDEN', `Missing permission ${code}`));
      return;
    }
    next();
  };
}
