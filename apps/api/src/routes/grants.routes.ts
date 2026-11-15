import {
  PERMISSIONS,
  grantCreate,
  grantListQuery,
  grantStatusChange,
  grantUpdate,
  idParam,
  type GrantCreate,
  type GrantListQuery,
  type GrantStatusChange,
  type GrantUpdate,
} from '@ngo/shared';
import { Router } from 'express';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { GrantService } from '../services/grant.service';
import { handle, type ServiceFactory } from './route-helpers';

/**
 * Grants: read by any member (`?selectableFor=pr&prDate=&officeId=` for the PR form), write and
 * status changes with grants:manage.
 */
export function grantsRouter(
  service: ServiceFactory<GrantService> = GrantService.forContext
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

  return router;
}
