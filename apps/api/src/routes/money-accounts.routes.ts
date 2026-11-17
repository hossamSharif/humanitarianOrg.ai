import { PERMISSIONS_002, moneyAccountListQuery, type MoneyAccountListQuery } from '@ngo/shared';
import { Router } from 'express';
import { withTenantTx } from '../db/tx';
import { requireAnyPermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { MoneyAccountRepository } from '../repositories/money-account.repository';
import { handle } from './route-helpers';

/**
 * Bank accounts and cash boxes (002 data-model §6, contracts/rest-api.md "Accounting"): the read
 * side for the payment-request picker with finance:read or payment:create — active accounts with
 * their currency and office, `?currency=` keeps the ones that pay in the request currency.
 */
export function moneyAccountsRouter(): Router {
  const router = Router();
  const canRead = requireAnyPermission(
    PERMISSIONS_002.FINANCE_READ,
    PERMISSIONS_002.PAYMENT_CREATE
  );

  for (const [path, kind] of [
    ['/bank-accounts', 'bank'],
    ['/cash-boxes', 'cash'],
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
  }

  return router;
}
