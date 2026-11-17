import {
  PERMISSIONS_002,
  createInvoiceBody,
  idParam,
  invoiceListQuery,
  type CreateInvoiceInput,
  type InvoiceListQuery,
} from '@ngo/shared';
import { Router } from 'express';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { InvoiceService } from '../services/invoice.service';
import { handle } from './route-helpers';

/**
 * Supplier invoices (002 US11, contracts/rest-api.md "Invoices and payment requests"): read with
 * finance:read (or the registering and paying permissions); register against a PO with
 * invoice:register.
 */
export function invoicesRouter(service = new InvoiceService()): Router {
  const router = Router();
  const canRead = requireAnyPermission(
    PERMISSIONS_002.FINANCE_READ,
    PERMISSIONS_002.INVOICE_REGISTER,
    PERMISSIONS_002.PAYMENT_CREATE
  );

  router.post(
    '/pos/:id/invoices',
    requirePermission(PERMISSIONS_002.INVOICE_REGISTER),
    validate({ params: idParam, body: createInvoiceBody }),
    handle(async (req, res, ctx) => {
      res
        .status(201)
        .json(await service.register(ctx, req.params.id!, req.body as CreateInvoiceInput));
    })
  );

  router.get(
    '/invoices',
    canRead,
    validate({ query: invoiceListQuery }),
    handle(async (req, res, ctx) => {
      res.json(await service.list(ctx, req.query as unknown as InvoiceListQuery));
    })
  );

  router.get(
    '/invoices/:id',
    canRead,
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json(await service.get(ctx, req.params.id!));
    })
  );

  return router;
}
