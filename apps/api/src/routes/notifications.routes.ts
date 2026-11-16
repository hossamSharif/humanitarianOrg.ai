import { idParam, notificationListQuery, type NotificationListQuery } from '@ngo/shared';
import { Router } from 'express';
import { validate } from '../middleware/validate';
import { NotificationInbox } from '../services/notification.service';
import { handle, type ServiceFactory } from './route-helpers';

/** The caller's in-app notifications (FR-048); any member, own rows only. */
export function notificationsRouter(
  inbox: ServiceFactory<NotificationInbox> = NotificationInbox.forContext
): Router {
  const router = Router();

  router.get(
    '/notifications',
    validate({ query: notificationListQuery }),
    handle(async (req, res, ctx) => {
      res.json(await inbox(ctx).list(req.query as unknown as NotificationListQuery));
    })
  );

  // before /:id/read so "read-all" is never taken for an id
  router.post(
    '/notifications/read-all',
    handle(async (_req, res, ctx) => {
      res.json(await inbox(ctx).markAllRead());
    })
  );

  router.post(
    '/notifications/:id/read',
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json(await inbox(ctx).markRead(req.params.id!));
    })
  );

  return router;
}
