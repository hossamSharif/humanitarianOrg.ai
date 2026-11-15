import {
  PERMISSIONS,
  activityCreate,
  activityUpdate,
  idParam,
  type ActivityCreate,
  type ActivityUpdate,
} from '@ngo/shared';
import { Router } from 'express';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { ActivityService } from '../services/activity.service';
import { handle, type ServiceFactory } from './route-helpers';

/** Activities per grant: read by members, write with grants:manage. */
export function activitiesRouter(
  service: ServiceFactory<ActivityService> = ActivityService.forContext
): Router {
  const router = Router();

  router.get(
    '/grants/:id/activities',
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json({ data: await service(ctx).list(req.params.id!) });
    })
  );

  router.post(
    '/grants/:id/activities',
    requirePermission(PERMISSIONS.GRANTS_MANAGE),
    validate({ params: idParam, body: activityCreate }),
    handle(async (req, res, ctx) => {
      res.status(201).json(await service(ctx).create(req.params.id!, req.body as ActivityCreate));
    })
  );

  router.patch(
    '/activities/:id',
    requirePermission(PERMISSIONS.GRANTS_MANAGE),
    validate({ params: idParam, body: activityUpdate }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).update(req.params.id!, req.body as ActivityUpdate));
    })
  );

  return router;
}
