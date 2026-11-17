import {
  PERMISSIONS_002,
  createDeductionTypeBody,
  createPaymentCategoryBody,
  createSupplierCategoryBody,
  idParam,
  methodBandsBody,
  procurementSettingsBody,
  resolveMethodBody,
  updateDeductionTypeBody,
  updatePaymentCategoryBody,
  updateSupplierCategoryBody,
  type CreateDeductionTypeInput,
  type CreatePaymentCategoryInput,
  type CreateSupplierCategoryInput,
  type MethodBandsInput,
  type ProcurementSettingsInput,
  type ResolveMethodInput,
  type UpdateDeductionTypeInput,
  type UpdatePaymentCategoryInput,
  type UpdateSupplierCategoryInput,
} from '@ngo/shared';
import { Router } from 'express';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { ProcurementConfigService } from '../services/procurement-config.service';
import { handle } from './route-helpers';

/**
 * Procurement configuration (002 US1, contracts/rest-api.md): settings and method bands read
 * with procurement:read and written with procurement:configure; deduction types with
 * accounts:manage; payment and supplier categories written with procurement:configure.
 */
export function procurementSettingsRouter(service = new ProcurementConfigService()): Router {
  const router = Router();
  const canRead = requirePermission(PERMISSIONS_002.PROCUREMENT_READ);
  const canConfigure = requirePermission(PERMISSIONS_002.PROCUREMENT_CONFIGURE);
  const canManageAccounts = requirePermission(PERMISSIONS_002.ACCOUNTS_MANAGE);
  const canReadLists = requireAnyPermission(
    PERMISSIONS_002.PROCUREMENT_READ,
    PERMISSIONS_002.FINANCE_READ,
    PERMISSIONS_002.ACCOUNTS_MANAGE
  );

  // --- settings and bands --------------------------------------------------------------------

  router.get(
    '/procurement-settings',
    canRead,
    handle(async (_req, res, ctx) => {
      res.json(await service.getSettings(ctx));
    })
  );

  router.put(
    '/procurement-settings',
    canConfigure,
    validate({ body: procurementSettingsBody }),
    handle(async (req, res, ctx) => {
      res.json(await service.updateSettings(ctx, req.body as ProcurementSettingsInput));
    })
  );

  router.get(
    '/procurement-settings/method-bands',
    canRead,
    handle(async (_req, res, ctx) => {
      res.json(await service.getTenantBands(ctx));
    })
  );

  router.put(
    '/procurement-settings/method-bands',
    canConfigure,
    validate({ body: methodBandsBody }),
    handle(async (req, res, ctx) => {
      res.json(await service.replaceTenantBands(ctx, req.body as MethodBandsInput));
    })
  );

  router.post(
    '/procurement-settings/resolve-method',
    canRead,
    validate({ body: resolveMethodBody }),
    handle(async (req, res, ctx) => {
      res.json(await service.resolveMethod(ctx, req.body as ResolveMethodInput));
    })
  );

  // --- deduction types -----------------------------------------------------------------------

  router.get(
    '/deduction-types',
    canReadLists,
    handle(async (_req, res, ctx) => {
      res.json({ data: await service.listDeductionTypes(ctx) });
    })
  );

  router.post(
    '/deduction-types',
    canManageAccounts,
    validate({ body: createDeductionTypeBody }),
    handle(async (req, res, ctx) => {
      res
        .status(201)
        .json(await service.createDeductionType(ctx, req.body as CreateDeductionTypeInput));
    })
  );

  router.patch(
    '/deduction-types/:id',
    canManageAccounts,
    validate({ params: idParam, body: updateDeductionTypeBody }),
    handle(async (req, res, ctx) => {
      res.json(
        await service.updateDeductionType(ctx, req.params.id!, req.body as UpdateDeductionTypeInput)
      );
    })
  );

  // --- payment categories --------------------------------------------------------------------

  router.get(
    '/payment-categories',
    canReadLists,
    handle(async (_req, res, ctx) => {
      res.json({ data: await service.listPaymentCategories(ctx) });
    })
  );

  router.post(
    '/payment-categories',
    canConfigure,
    validate({ body: createPaymentCategoryBody }),
    handle(async (req, res, ctx) => {
      res
        .status(201)
        .json(await service.createPaymentCategory(ctx, req.body as CreatePaymentCategoryInput));
    })
  );

  router.patch(
    '/payment-categories/:id',
    canConfigure,
    validate({ params: idParam, body: updatePaymentCategoryBody }),
    handle(async (req, res, ctx) => {
      res.json(
        await service.updatePaymentCategory(
          ctx,
          req.params.id!,
          req.body as UpdatePaymentCategoryInput
        )
      );
    })
  );

  // --- supplier categories -------------------------------------------------------------------

  router.get(
    '/supplier-categories',
    requireAnyPermission(PERMISSIONS_002.PROCUREMENT_READ, PERMISSIONS_002.SUPPLIERS_READ),
    handle(async (_req, res, ctx) => {
      res.json({ data: await service.listSupplierCategories(ctx) });
    })
  );

  router.post(
    '/supplier-categories',
    canConfigure,
    validate({ body: createSupplierCategoryBody }),
    handle(async (req, res, ctx) => {
      res
        .status(201)
        .json(await service.createSupplierCategory(ctx, req.body as CreateSupplierCategoryInput));
    })
  );

  router.patch(
    '/supplier-categories/:id',
    canConfigure,
    validate({ params: idParam, body: updateSupplierCategoryBody }),
    handle(async (req, res, ctx) => {
      res.json(
        await service.updateSupplierCategory(
          ctx,
          req.params.id!,
          req.body as UpdateSupplierCategoryInput
        )
      );
    })
  );

  return router;
}
