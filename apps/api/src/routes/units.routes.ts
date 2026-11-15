import {
  activeFilterQuery,
  createUnitBody,
  idParam,
  listQuery,
  PERMISSIONS,
  updateUnitBody,
  type CreateUnitInput,
  type Pagination,
  type Sort,
  type UpdateUnitInput,
} from '@ngo/shared';
import { Router } from 'express';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { UnitRepository } from '../repositories/unit.repository';
import { UnitService } from '../services/unit.service';
import type { RequestContext } from '../types/context';

export const unitListQuery = listQuery.merge(activeFilterQuery);

type ListQuery = Pagination & { sort?: Sort; active?: boolean };

export type UnitServiceFactory = (ctx: RequestContext) => UnitService;

const defaultFactory: UnitServiceFactory = (ctx) => new UnitService(new UnitRepository(ctx));

/** /units — read: member; write: settings:manage. No DELETE: deactivate with isActive=false. */
export function unitsRouter(make: UnitServiceFactory = defaultFactory): Router {
  const router = Router();

  router.get('/units', validate({ query: unitListQuery }), async (req, res, next) => {
    try {
      const { page, pageSize, sort, active } = req.query as unknown as ListQuery;
      res.json(await make(req.ctx!).list({ pagination: { page, pageSize }, sort, active }));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/units',
    requirePermission(PERMISSIONS.SETTINGS_MANAGE),
    validate({ body: createUnitBody }),
    async (req, res, next) => {
      try {
        res.status(201).json(await make(req.ctx!).create(req.body as CreateUnitInput));
      } catch (err) {
        next(err);
      }
    }
  );

  router.patch(
    '/units/:id',
    requirePermission(PERMISSIONS.SETTINGS_MANAGE),
    validate({ params: idParam, body: updateUnitBody }),
    async (req, res, next) => {
      try {
        const { id } = req.params as { id: string };
        res.json(await make(req.ctx!).update(id, req.body as UpdateUnitInput));
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
