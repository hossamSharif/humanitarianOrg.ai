import {
  PERMISSIONS,
  donorCreate,
  donorListQuery,
  donorUpdate,
  idParam,
  type DonorCreate,
  type DonorListQuery,
  type DonorUpdate,
} from '@ngo/shared';
import { Router } from 'express';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { GrantService } from '../services/grant.service';
import { handle, type ServiceFactory } from './route-helpers';

/** Donors: read by any member, write with grants:manage. */
export function donorsRouter(
  service: ServiceFactory<GrantService> = GrantService.forContext
): Router {
  const router = Router();

  router.get(
    '/donors',
    validate({ query: donorListQuery }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).listDonors(req.query as unknown as DonorListQuery));
    })
  );

  router.get(
    '/donors/:id',
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).getDonor(req.params.id!));
    })
  );

  router.post(
    '/donors',
    requirePermission(PERMISSIONS.GRANTS_MANAGE),
    validate({ body: donorCreate }),
    handle(async (req, res, ctx) => {
      res.status(201).json(await service(ctx).createDonor(req.body as DonorCreate));
    })
  );

  router.patch(
    '/donors/:id',
    requirePermission(PERMISSIONS.GRANTS_MANAGE),
    validate({ params: idParam, body: donorUpdate }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).updateDonor(req.params.id!, req.body as DonorUpdate));
    })
  );

  return router;
}
