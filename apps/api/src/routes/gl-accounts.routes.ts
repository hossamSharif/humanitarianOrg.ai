import {
  PERMISSIONS_002,
  budgetLineExpenseAccountBody,
  categoryMappingBody,
  controlAccountsBody,
  createGlAccountBody,
  glAccountListQuery,
  idParam,
  updateGlAccountBody,
  uuid,
  type BudgetLineExpenseAccountInput,
  type CategoryMappingInput,
  type ControlAccountsInput,
  type CreateGlAccountInput,
  type GlAccountListQuery,
  type UpdateGlAccountInput,
} from '@ngo/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { AccountingSetupService } from '../services/accounting-setup.service';
import { handle } from './route-helpers';

const grantQuery = z.object({ grantId: uuid });

/**
 * Chart of accounts and mappings (002 US12, contracts/rest-api.md "Accounting"): read with
 * finance:read; write with accounts:manage. DELETE is refused with 409 ACCOUNT_IN_USE once
 * anything refers to the account. `GET /gl-accounts/budget-lines?grantId=` lists a grant's
 * budget lines with their own and resolved expense account, for the per-line override.
 */
export function glAccountsRouter(service = new AccountingSetupService()): Router {
  const router = Router();
  const canRead = requirePermission(PERMISSIONS_002.FINANCE_READ);
  const canManage = requirePermission(PERMISSIONS_002.ACCOUNTS_MANAGE);

  router.get(
    '/gl-accounts',
    canRead,
    validate({ query: glAccountListQuery }),
    handle(async (req, res, ctx) => {
      res.json({
        data: await service.listAccounts(ctx, req.query as unknown as GlAccountListQuery),
      });
    })
  );

  router.post(
    '/gl-accounts',
    canManage,
    validate({ body: createGlAccountBody }),
    handle(async (req, res, ctx) => {
      res.status(201).json(await service.createAccount(ctx, req.body as CreateGlAccountInput));
    })
  );

  router.get(
    '/gl-accounts/category-mapping',
    canRead,
    handle(async (_req, res, ctx) => {
      res.json({ data: await service.categoryMappings(ctx) });
    })
  );

  router.put(
    '/gl-accounts/category-mapping',
    canManage,
    validate({ body: categoryMappingBody }),
    handle(async (req, res, ctx) => {
      res.json({
        data: await service.setCategoryMappings(ctx, req.body as CategoryMappingInput),
      });
    })
  );

  router.get(
    '/gl-accounts/budget-lines',
    canRead,
    validate({ query: grantQuery }),
    handle(async (req, res, ctx) => {
      const { grantId } = req.query as unknown as z.infer<typeof grantQuery>;
      res.json({ data: await service.budgetLineAccounts(ctx, grantId) });
    })
  );

  router.patch(
    '/gl-accounts/:id',
    canManage,
    validate({ params: idParam, body: updateGlAccountBody }),
    handle(async (req, res, ctx) => {
      res.json(await service.updateAccount(ctx, req.params.id!, req.body as UpdateGlAccountInput));
    })
  );

  router.delete(
    '/gl-accounts/:id',
    canManage,
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      await service.deleteAccount(ctx, req.params.id!);
      res.status(204).end();
    })
  );

  router.get(
    '/control-accounts',
    canRead,
    handle(async (_req, res, ctx) => {
      res.json({ data: await service.controlAccounts(ctx) });
    })
  );

  router.put(
    '/control-accounts',
    canManage,
    validate({ body: controlAccountsBody }),
    handle(async (req, res, ctx) => {
      res.json({
        data: await service.setControlAccounts(ctx, req.body as ControlAccountsInput),
      });
    })
  );

  router.patch(
    '/budget-lines/:id/expense-account',
    canManage,
    validate({ params: idParam, body: budgetLineExpenseAccountBody }),
    handle(async (req, res, ctx) => {
      await service.setBudgetLineAccount(
        ctx,
        req.params.id!,
        req.body as BudgetLineExpenseAccountInput
      );
      res.status(204).end();
    })
  );

  return router;
}
