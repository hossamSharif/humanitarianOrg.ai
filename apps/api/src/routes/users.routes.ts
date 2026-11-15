import {
  PERMISSIONS,
  membershipIdParam,
  userInvite,
  userListQuery,
  userUpdate,
  type UserInvite,
  type UserListQuery,
  type UserUpdate,
} from '@ngo/shared';
import { Router } from 'express';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { UserService } from '../services/user.service';

export function usersRouter(service = new UserService()): Router {
  const router = Router();
  const canManage = requirePermission(PERMISSIONS.USERS_MANAGE);

  router.get('/users', canManage, validate({ query: userListQuery }), async (req, res, next) => {
    try {
      res.json(await service.list(req.ctx!, req.query as unknown as UserListQuery));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/users/invite',
    canManage,
    validate({ body: userInvite }),
    async (req, res, next) => {
      try {
        res.status(201).json(await service.invite(req.ctx!, req.body as UserInvite));
      } catch (err) {
        next(err);
      }
    }
  );

  router.patch(
    '/users/:membershipId',
    canManage,
    validate({ params: membershipIdParam, body: userUpdate }),
    async (req, res, next) => {
      try {
        const { membershipId } = req.params as { membershipId: string };
        res.json(await service.update(req.ctx!, membershipId, req.body as UserUpdate));
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
