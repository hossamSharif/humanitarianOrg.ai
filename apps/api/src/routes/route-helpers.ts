// Shared bits for feature routers: async handlers forward errors to the error middleware, and
// services are built per request from the tenant context (routes validate, services decide).
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../middleware/error';
import type { RequestContext } from '../types/context';

export type ServiceFactory<S> = (ctx: RequestContext) => S;

export function handle(
  fn: (req: Request, res: Response, ctx: RequestContext) => Promise<void>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.ctx) {
      next(new AppError('FORBIDDEN', 'No tenant context'));
      return;
    }
    fn(req, res, req.ctx).catch(next);
  };
}
