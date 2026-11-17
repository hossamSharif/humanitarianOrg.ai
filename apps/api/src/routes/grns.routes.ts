import {
  PERMISSIONS_002,
  createGrnBody,
  grnCancelBody,
  grnLineParams,
  grnListQuery,
  grnReturnBody,
  grnSignBody,
  idParam,
  poRatingBody,
  type CreateGrnInput,
  type GrnCancelInput,
  type GrnListQuery,
  type GrnReturnInput,
  type GrnSignInput,
  type PoRatingInput,
} from '@ngo/shared';
import { Router } from 'express';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { DocHistoryService } from '../services/doc-history.service';
import { ReceiptService } from '../services/receipt.service';
import { handle } from './route-helpers';

/**
 * Goods received notes (002 US7, contracts/rest-api.md "Receipt"): read with procurement:read
 * (or the receiving permissions); create, return and cancel with grn:create; sign as Received By
 * with grn:create and as Inspected By with grn:inspect (decided per role by the service). The
 * PO's supplier rating is here too, since it follows the receipt.
 */
export function grnsRouter(service = new ReceiptService()): Router {
  const router = Router();
  const canRead = requireAnyPermission(
    PERMISSIONS_002.PROCUREMENT_READ,
    PERMISSIONS_002.GRN_CREATE,
    PERMISSIONS_002.GRN_INSPECT
  );
  const canReceive = requirePermission(PERMISSIONS_002.GRN_CREATE);

  router.post(
    '/pos/:id/grns',
    canReceive,
    validate({ params: idParam, body: createGrnBody }),
    handle(async (req, res, ctx) => {
      res.status(201).json(await service.create(ctx, req.params.id!, req.body as CreateGrnInput));
    })
  );

  router.post(
    '/pos/:id/rating',
    requireAnyPermission(PERMISSIONS_002.PO_CREATE, PERMISSIONS_002.GRN_CREATE),
    validate({ params: idParam, body: poRatingBody }),
    handle(async (req, res, ctx) => {
      await service.rate(ctx, req.params.id!, req.body as PoRatingInput);
      res.status(204).end();
    })
  );

  router.get(
    '/grns',
    canRead,
    validate({ query: grnListQuery }),
    handle(async (req, res, ctx) => {
      res.json(await service.list(ctx, req.query as unknown as GrnListQuery));
    })
  );

  router.get(
    '/grns/:id',
    canRead,
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json(await service.get(ctx, req.params.id!));
    })
  );

  router.get(
    '/grns/:id/history',
    canRead,
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json({ data: await DocHistoryService.forContext(ctx).history('GRN', req.params.id!, 'grn') });
    })
  );

  router.post(
    '/grns/:id/sign',
    requireAnyPermission(PERMISSIONS_002.GRN_CREATE, PERMISSIONS_002.GRN_INSPECT),
    validate({ params: idParam, body: grnSignBody }),
    handle(async (req, res, ctx) => {
      res.json(await service.sign(ctx, req.params.id!, req.body as GrnSignInput));
    })
  );

  router.post(
    '/grns/:id/lines/:lineId/return',
    canReceive,
    validate({ params: grnLineParams, body: grnReturnBody }),
    handle(async (req, res, ctx) => {
      res.json(
        await service.returnLine(ctx, req.params.id!, req.params.lineId!, req.body as GrnReturnInput)
      );
    })
  );

  router.post(
    '/grns/:id/cancel',
    canReceive,
    validate({ params: idParam, body: grnCancelBody }),
    handle(async (req, res, ctx) => {
      res.json(await service.cancel(ctx, req.params.id!, req.body as GrnCancelInput));
    })
  );

  return router;
}
