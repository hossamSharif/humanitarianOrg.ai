import {
  PERMISSIONS,
  PERMISSIONS_002,
  grantCreate,
  grantListQuery,
  grantStatusChange,
  grantUpdate,
  idParam,
  methodBandsBody,
  type GrantCreate,
  type GrantListQuery,
  type GrantStatusChange,
  type GrantUpdate,
  type MethodBandsInput,
} from '@ngo/shared';
import { Router } from 'express';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { GrantService } from '../services/grant.service';
import { ProcurementConfigService } from '../services/procurement-config.service';
import { handle, type ServiceFactory } from './route-helpers';

/**
 * Grants: read by any member (`?selectableFor=pr&prDate=&officeId=` for the PR form), write and
 * status changes with grants:manage. 002: the grant's stricter procurement bands
 * (procurement:configure; an empty set removes them).
 */
export function grantsRouter(
  service: ServiceFactory<GrantService> = GrantService.forContext,
  procurement = new ProcurementConfigService()
): Router {
  const router = Router();

  router.get(
    '/grants',
    validate({ query: grantListQuery }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).listGrants(req.query as unknown as GrantListQuery));
    })
  );

  router.get(
    '/grants/:id',
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).getGrant(req.params.id!));
    })
  );

  router.post(
    '/grants',
    requirePermission(PERMISSIONS.GRANTS_MANAGE),
    validate({ body: grantCreate }),
    handle(async (req, res, ctx) => {
      res.status(201).json(await service(ctx).createGrant(req.body as GrantCreate));
    })
  );

  router.patch(
    '/grants/:id',
    requirePermission(PERMISSIONS.GRANTS_MANAGE),
    validate({ params: idParam, body: grantUpdate }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).updateGrant(req.params.id!, req.body as GrantUpdate));
    })
  );

  router.post(
    '/grants/:id/status',
    requirePermission(PERMISSIONS.GRANTS_MANAGE),
    validate({ params: idParam, body: grantStatusChange }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).changeStatus(req.params.id!, req.body as GrantStatusChange));
    })
  );

  router.get(
    '/grants/:id/procurement-rules',
    requirePermission(PERMISSIONS_002.PROCUREMENT_CONFIGURE),
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json(await procurement.getGrantBands(ctx, req.params.id!));
    })
  );

  router.put(
    '/grants/:id/procurement-rules',
    requirePermission(PERMISSIONS_002.PROCUREMENT_CONFIGURE),
    validate({ params: idParam, body: methodBandsBody }),
    handle(async (req, res, ctx) => {
      res.json(
        await procurement.replaceGrantBands(ctx, req.params.id!, req.body as MethodBandsInput)
      );
    })
  );

  return router;
}
