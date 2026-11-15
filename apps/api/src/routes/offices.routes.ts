import {
  activeFilterQuery,
  createOfficeBody,
  idParam,
  listQuery,
  PERMISSIONS,
  updateOfficeBody,
  type CreateOfficeInput,
  type Pagination,
  type Sort,
  type UpdateOfficeInput,
} from '@ngo/shared';
import { Router } from 'express';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { OfficeRepository } from '../repositories/office.repository';
import { OfficeService } from '../services/office.service';
import type { RequestContext } from '../types/context';

export const officeListQuery = listQuery.merge(activeFilterQuery);

type ListQuery = Pagination & { sort?: Sort; active?: boolean };

export type OfficeServiceFactory = (ctx: RequestContext) => OfficeService;

const defaultFactory: OfficeServiceFactory = (ctx) => new OfficeService(new OfficeRepository(ctx));

/** /offices — read: member; write: settings:manage. No DELETE: deactivate with isActive=false. */
export function officesRouter(make: OfficeServiceFactory = defaultFactory): Router {
  const router = Router();

  router.get('/offices', validate({ query: officeListQuery }), async (req, res, next) => {
    try {
      const { page, pageSize, sort, active } = req.query as unknown as ListQuery;
      res.json(await make(req.ctx!).list({ pagination: { page, pageSize }, sort, active }));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/offices',
    requirePermission(PERMISSIONS.SETTINGS_MANAGE),
    validate({ body: createOfficeBody }),
    async (req, res, next) => {
      try {
        res.status(201).json(await make(req.ctx!).create(req.body as CreateOfficeInput));
      } catch (err) {
        next(err);
      }
    }
  );

  router.patch(
    '/offices/:id',
    requirePermission(PERMISSIONS.SETTINGS_MANAGE),
    validate({ params: idParam, body: updateOfficeBody }),
    async (req, res, next) => {
      try {
        const { id } = req.params as { id: string };
        res.json(await make(req.ctx!).update(id, req.body as UpdateOfficeInput));
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
