import {
  PERMISSIONS_002,
  createBankAccountBody,
  createCashBoxBody,
  idParam,
  moneyAccountListQuery,
  updateMoneyAccountBody,
  type CreateBankAccountInput,
  type CreateCashBoxInput,
  type MoneyAccountListQuery,
  type UpdateMoneyAccountInput,
} from '@ngo/shared';
import { Router } from 'express';
import { withTenantTx } from '../db/tx';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { MoneyAccountRepository } from '../repositories/money-account.repository';
import { AccountingSetupService } from '../services/accounting-setup.service';
import { handle } from './route-helpers';

/**
 * Bank accounts and cash boxes (002 data-model §6, contracts/rest-api.md "Accounting"): read
 * with finance:read or payment:create (the payment-request picker; `?currency=` keeps the ones
 * that pay in the request currency); create and edit with bank:manage. The currency and the
 * ledger account of an account never change.
 */
export function moneyAccountsRouter(service = new AccountingSetupService()): Router {
  const router = Router();
  const canRead = requireAnyPermission(
    PERMISSIONS_002.FINANCE_READ,
    PERMISSIONS_002.PAYMENT_CREATE
  );
  const canManage = requirePermission(PERMISSIONS_002.BANK_MANAGE);

  for (const [path, kind, createBody] of [
    ['/bank-accounts', 'bank', createBankAccountBody],
    ['/cash-boxes', 'cash', createCashBoxBody],
  ] as const) {
    router.get(
      path,
      canRead,
      validate({ query: moneyAccountListQuery }),
      handle(async (req, res, ctx) => {
        const query = req.query as unknown as MoneyAccountListQuery;
        const data = await withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, (tx) =>
          new MoneyAccountRepository(tx.sql, ctx.tenantId).list({ kind, ...query })
        );
        res.json({ data });
      })
    );

    router.post(
      path,
      canManage,
      validate({ body: createBody }),
      handle(async (req, res, ctx) => {
        res
          .status(201)
          .json(
            await service.createMoneyAccount(
              ctx,
              kind,
              req.body as CreateBankAccountInput | CreateCashBoxInput
            )
          );
      })
    );

    router.patch(
      `${path}/:id`,
      canManage,
      validate({ params: idParam, body: updateMoneyAccountBody }),
      handle(async (req, res, ctx) => {
        res.json(
          await service.updateMoneyAccount(
            ctx,
            kind,
            req.params.id!,
            req.body as UpdateMoneyAccountInput
          )
        );
      })
    );
  }

  return router;
}
