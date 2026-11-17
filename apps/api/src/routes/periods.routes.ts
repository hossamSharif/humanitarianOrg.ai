import {
  PERMISSIONS_002,
  closePeriodBody,
  createPeriodBody,
  idParam,
  reopenPeriodBody,
  type ClosePeriodInput,
  type CreatePeriodInput,
  type ReopenPeriodInput,
} from '@ngo/shared';
import { Router } from 'express';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { PeriodService } from '../services/period.service';
import { handle } from './route-helpers';

/**
 * Accounting periods (002 US12, contracts/rest-api.md "Accounting", research R33): read with
 * finance:read; open, close (with the unposted-voucher warning) and reopen (with a reason) with
 * periods:manage.
 */
export function periodsRouter(service = new PeriodService()): Router {
  const router = Router();
  const canManage = requirePermission(PERMISSIONS_002.PERIODS_MANAGE);

  router.get(
    '/periods',
    requirePermission(PERMISSIONS_002.FINANCE_READ),
    handle(async (_req, res, ctx) => {
      res.json({ data: await service.list(ctx) });
    })
  );

  router.post(
    '/periods',
    canManage,
    validate({ body: createPeriodBody }),
    handle(async (req, res, ctx) => {
      res.status(201).json(await service.create(ctx, req.body as CreatePeriodInput));
    })
  );

  router.post(
    '/periods/:id/close',
    canManage,
    validate({ params: idParam, body: closePeriodBody }),
    handle(async (req, res, ctx) => {
      res.json(await service.close(ctx, req.params.id!, req.body as ClosePeriodInput));
    })
  );

  router.post(
    '/periods/:id/reopen',
    canManage,
    validate({ params: idParam, body: reopenPeriodBody }),
    handle(async (req, res, ctx) => {
      res.json(await service.reopen(ctx, req.params.id!, req.body as ReopenPeriodInput));
    })
  );

  return router;
}
