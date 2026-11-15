import {
  PERMISSIONS,
  idParam,
  pagination,
  roleCreate,
  roleUpdate,
  type Pagination,
  type RoleCreate,
  type RoleUpdate,
} from '@ngo/shared';
import { Router } from 'express';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { RoleService } from '../services/role.service';

export function rolesRouter(service = new RoleService()): Router {
  const router = Router();
  const canManage = requirePermission(PERMISSIONS.ROLES_MANAGE);

  router.get('/permissions', canManage, async (req, res, next) => {
    try {
      res.json({ data: await service.listPermissions(req.ctx!) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/roles', canManage, validate({ query: pagination }), async (req, res, next) => {
    try {
      res.json(await service.list(req.ctx!, req.query as unknown as Pagination));
    } catch (err) {
      next(err);
    }
  });

  router.get('/roles/:id', canManage, validate({ params: idParam }), async (req, res, next) => {
    try {
      res.json(await service.get(req.ctx!, (req.params as { id: string }).id));
    } catch (err) {
      next(err);
    }
  });

  router.post('/roles', canManage, validate({ body: roleCreate }), async (req, res, next) => {
    try {
      res.status(201).json(await service.create(req.ctx!, req.body as RoleCreate));
    } catch (err) {
      next(err);
    }
  });

  router.patch(
    '/roles/:id',
    canManage,
    validate({ params: idParam, body: roleUpdate }),
    async (req, res, next) => {
      try {
        const { id } = req.params as { id: string };
        res.json(await service.update(req.ctx!, id, req.body as RoleUpdate));
      } catch (err) {
        next(err);
      }
    }
  );

  router.delete('/roles/:id', canManage, validate({ params: idParam }), async (req, res, next) => {
    try {
      await service.delete(req.ctx!, (req.params as { id: string }).id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
