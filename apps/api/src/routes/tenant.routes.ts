import {
  createTenantBody,
  logoUploadBody,
  PERMISSIONS,
  updateTenantBody,
  type CreateTenantInput,
  type LogoUploadInput,
  type UpdateTenantInput,
} from '@ngo/shared';
import { Router } from 'express';
import { AppError } from '../middleware/error';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { TenantRepository } from '../repositories/tenant.repository';
import { TenantProfileService, TenantSetupService } from '../services/tenant-setup.service';
import type { RequestContext } from '../types/context';

/**
 * POST /tenants — mounted after authentication but before the tenant middleware: the caller has
 * no membership in the organization being created (and may have none at all).
 */
export function tenantBootstrapRouter(service = new TenantSetupService()): Router {
  const router = Router();

  router.post('/tenants', validate({ body: createTenantBody }), async (req, res, next) => {
    try {
      if (!req.auth) throw new AppError('UNAUTHORIZED', 'Not authenticated');
      const input = req.body as CreateTenantInput;
      res.status(201).json(await service.createTenant(req.auth, req.requestId, input));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export type ProfileServiceFactory = (ctx: RequestContext) => TenantProfileService;

const defaultProfileService: ProfileServiceFactory = (ctx) =>
  new TenantProfileService(ctx, new TenantRepository(ctx));

/** GET / PATCH /tenant, POST /tenant/logo-upload-url. */
export function tenantProfileRouter(make: ProfileServiceFactory = defaultProfileService): Router {
  const router = Router();

  router.get('/tenant', async (req, res, next) => {
    try {
      res.json(await make(req.ctx!).getProfile());
    } catch (err) {
      next(err);
    }
  });

  router.patch(
    '/tenant',
    requirePermission(PERMISSIONS.SETTINGS_MANAGE),
    validate({ body: updateTenantBody }),
    async (req, res, next) => {
      try {
        res.json(await make(req.ctx!).updateProfile(req.body as UpdateTenantInput));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    '/tenant/logo-upload-url',
    requirePermission(PERMISSIONS.SETTINGS_MANAGE),
    validate({ body: logoUploadBody }),
    async (req, res, next) => {
      try {
        res.json(await make(req.ctx!).createLogoUploadUrl(req.body as LogoUploadInput));
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
