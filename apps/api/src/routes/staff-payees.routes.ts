import {
  PERMISSIONS_002,
  createStaffPayeeBody,
  idParam,
  staffPayeeListQuery,
  updateStaffPayeeBody,
  type CreateStaffPayeeInput,
  type StaffPayeeListQuery,
  type UpdateStaffPayeeInput,
} from '@ngo/shared';
import { Router } from 'express';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { StaffPayeeService } from '../services/staff-payee.service';
import { handle } from './route-helpers';

/** Staff payees (contracts/rest-api.md "Suppliers"): payment:create for read and write. */
export function staffPayeesRouter(service = new StaffPayeeService()): Router {
  const router = Router();
  const canPay = requirePermission(PERMISSIONS_002.PAYMENT_CREATE);

  router.get(
    '/staff-payees',
    canPay,
    validate({ query: staffPayeeListQuery }),
    handle(async (req, res, ctx) => {
      res.json(await service.list(ctx, req.query as unknown as StaffPayeeListQuery));
    })
  );

  router.post(
    '/staff-payees',
    canPay,
    validate({ body: createStaffPayeeBody }),
    handle(async (req, res, ctx) => {
      res.status(201).json(await service.create(ctx, req.body as CreateStaffPayeeInput));
    })
  );

  router.get(
    '/staff-payees/:id',
    canPay,
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json(await service.get(ctx, req.params.id!));
    })
  );

  router.patch(
    '/staff-payees/:id',
    canPay,
    validate({ params: idParam, body: updateStaffPayeeBody }),
    handle(async (req, res, ctx) => {
      res.json(await service.update(ctx, req.params.id!, req.body as UpdateStaffPayeeInput));
    })
  );

  return router;
}
