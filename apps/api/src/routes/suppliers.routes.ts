import {
  PERMISSIONS_002,
  createSupplierBody,
  idParam,
  supplierDocumentBody,
  supplierListQuery,
  supplierStatusBody,
  supplierVettingBody,
  updateSupplierBody,
  type CreateSupplierInput,
  type SupplierDocumentInput,
  type SupplierListQuery,
  type SupplierStatusInput,
  type SupplierVettingInput,
  type UpdateSupplierInput,
} from '@ngo/shared';
import { Router } from 'express';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { SupplierService } from '../services/supplier.service';
import { handle } from './route-helpers';

/**
 * Supplier registry (002 US2, contracts/rest-api.md "Suppliers"): read with suppliers:read (or
 * suppliers:vet, so vetting officers see what they vet); create, edit and documents with
 * suppliers:manage; vettings with suppliers:vet. Status changes: approving needs suppliers:vet,
 * suspending and blacklisting suppliers:manage (checked by the service).
 */
export function suppliersRouter(service = new SupplierService()): Router {
  const router = Router();
  const canRead = requireAnyPermission(
    PERMISSIONS_002.SUPPLIERS_READ,
    PERMISSIONS_002.SUPPLIERS_MANAGE,
    PERMISSIONS_002.SUPPLIERS_VET
  );
  const canManage = requirePermission(PERMISSIONS_002.SUPPLIERS_MANAGE);
  const canVet = requirePermission(PERMISSIONS_002.SUPPLIERS_VET);

  router.get(
    '/suppliers',
    canRead,
    validate({ query: supplierListQuery }),
    handle(async (req, res, ctx) => {
      res.json(await service.list(ctx, req.query as unknown as SupplierListQuery));
    })
  );

  router.post(
    '/suppliers',
    canManage,
    validate({ body: createSupplierBody }),
    handle(async (req, res, ctx) => {
      res.status(201).json(await service.create(ctx, req.body as CreateSupplierInput));
    })
  );

  router.get(
    '/suppliers/:id',
    canRead,
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json(await service.get(ctx, req.params.id!));
    })
  );

  router.patch(
    '/suppliers/:id',
    canManage,
    validate({ params: idParam, body: updateSupplierBody }),
    handle(async (req, res, ctx) => {
      res.json(await service.update(ctx, req.params.id!, req.body as UpdateSupplierInput));
    })
  );

  router.post(
    '/suppliers/:id/status',
    requireAnyPermission(PERMISSIONS_002.SUPPLIERS_MANAGE, PERMISSIONS_002.SUPPLIERS_VET),
    validate({ params: idParam, body: supplierStatusBody }),
    handle(async (req, res, ctx) => {
      res.json(await service.changeStatus(ctx, req.params.id!, req.body as SupplierStatusInput));
    })
  );

  router.get(
    '/suppliers/:id/documents',
    canRead,
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json({ data: (await service.get(ctx, req.params.id!)).documents });
    })
  );

  router.post(
    '/suppliers/:id/documents',
    canManage,
    validate({ params: idParam, body: supplierDocumentBody }),
    handle(async (req, res, ctx) => {
      res
        .status(201)
        .json(await service.addDocument(ctx, req.params.id!, req.body as SupplierDocumentInput));
    })
  );

  router.post(
    '/suppliers/:id/vettings',
    canVet,
    validate({ params: idParam, body: supplierVettingBody }),
    handle(async (req, res, ctx) => {
      res
        .status(201)
        .json(await service.addVetting(ctx, req.params.id!, req.body as SupplierVettingInput));
    })
  );

  return router;
}
