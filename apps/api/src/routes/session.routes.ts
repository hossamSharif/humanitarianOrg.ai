import { uuid } from '@ngo/shared';
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/error';
import { validate } from '../middleware/validate';
import { SessionService } from '../services/session.service';

const switchTenantBody = z.object({ tenantId: uuid });

/** Mounted after authentication but before the tenant middleware: works with no tenant yet. */
export function sessionRouter(service = new SessionService()): Router {
  const router = Router();

  router.get('/me', async (req, res, next) => {
    try {
      if (!req.auth) throw new AppError('UNAUTHORIZED', 'Not authenticated');
      res.json(await service.getMe(req.auth, req.requestId));
    } catch (err) {
      next(err);
    }
  });

  router.post('/session/tenant', validate({ body: switchTenantBody }), async (req, res, next) => {
    try {
      if (!req.auth) throw new AppError('UNAUTHORIZED', 'Not authenticated');
      const { tenantId } = req.body as z.infer<typeof switchTenantBody>;
      res.json(await service.switchTenant(req.auth, req.requestId, tenantId));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
