// Accounting setup (002 US12, FR-062–FR-064; research D5): the chart of accounts, the expense
// account per budget category and per budget line, the control accounts, and the bank accounts
// and cash boxes. The database enforces the shape — a parent is a group and children take its
// type, expense mappings point at posting expense accounts, a money account owns a posting asset
// account — so the service adds what needs a reason or a lookup: an account that anything refers
// to is deactivated, never deleted (409 ACCOUNT_IN_USE, US12-1), and voucher lines resolve their
// expense account as coalesce(budget line, category default) (BUDGET_LINE_UNMAPPED, US12-2).
import {
  PERMISSIONS_002,
  type BudgetLineAccountView,
  type BudgetLineExpenseAccountInput,
  type CategoryMappingInput,
  type CategoryMappingView,
  type ControlAccountView,
  type ControlAccountsInput,
  type CreateBankAccountInput,
  type CreateCashBoxInput,
  type CreateGlAccountInput,
  type GlAccountListQuery,
  type GlAccountView,
  type MoneyAccountView,
  type Permission,
  type UpdateGlAccountInput,
  type UpdateMoneyAccountInput,
} from '@ngo/shared';
import { withTenantTx, type TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import { BudgetCategoryAccountRepository } from '../repositories/budget-category-account.repository';
import { ControlAccountRepository } from '../repositories/control-account.repository';
import { GlAccountRepository } from '../repositories/gl-account.repository';
import { MoneyAccountRepository } from '../repositories/money-account.repository';
import type { RequestContext } from '../types/context';
import { ensureTenantSeeds } from './doc-adapters/binding';

export interface AccountingRepos {
  tx: TenantTx;
  ctx: RequestContext;
  accounts: GlAccountRepository;
  mappings: BudgetCategoryAccountRepository;
  controls: ControlAccountRepository;
  money: MoneyAccountRepository;
}

export interface AccountingServiceDeps {
  run<T>(ctx: RequestContext, fn: (repos: AccountingRepos) => Promise<T>): Promise<T>;
}

export function accountingRepos(tx: TenantTx, ctx: RequestContext): AccountingRepos {
  const t = ctx.tenantId;
  return {
    tx,
    ctx,
    accounts: new GlAccountRepository(tx.sql, t),
    mappings: new BudgetCategoryAccountRepository(tx.sql, t),
    controls: new ControlAccountRepository(tx.sql, t),
    money: new MoneyAccountRepository(tx.sql, t),
  };
}

export const defaultAccountingDeps: AccountingServiceDeps = {
  run: (ctx, fn) =>
    withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, async (tx) => {
      await ensureTenantSeeds(tx);
      return fn(accountingRepos(tx, ctx));
    }),
};

function assertPermission(ctx: RequestContext, permission: Permission): void {
  if (!ctx.permissions.has(permission)) {
    throw new AppError('FORBIDDEN', `Missing permission ${permission}`);
  }
}

/** The posting account must exist, be active and (optionally) of a type. */
async function assertPostingAccount(
  repos: AccountingRepos,
  id: string,
  field: string,
  type?: GlAccountView['type']
): Promise<GlAccountView> {
  const account = await repos.accounts.find(id);
  if (!account || !account.isPosting || !account.isActive || (type && account.type !== type)) {
    throw new AppError(
      'VALIDATION_ERROR',
      type
        ? `Choose an active posting account of type ${type}`
        : 'Choose an active posting account',
      [{ field, message: 'invalid_account' }]
    );
  }
  return account;
}

export class AccountingSetupService {
  constructor(private readonly deps: AccountingServiceDeps = defaultAccountingDeps) {}

  // --- chart of accounts ---------------------------------------------------------------------

  listAccounts(ctx: RequestContext, query: GlAccountListQuery): Promise<GlAccountView[]> {
    return this.deps.run(ctx, ({ accounts }) => accounts.list(query));
  }

  createAccount(ctx: RequestContext, input: CreateGlAccountInput): Promise<GlAccountView> {
    assertPermission(ctx, PERMISSIONS_002.ACCOUNTS_MANAGE);
    return this.deps.run(ctx, async ({ accounts }) => {
      if (await accounts.codeExists(input.code)) {
        throw new AppError('VALIDATION_ERROR', 'An account with this code already exists', [
          { field: 'code', message: 'already_exists' },
        ]);
      }
      let type = input.type;
      if (input.parentId) {
        const parent = await accounts.get(input.parentId);
        if (parent.isPosting) {
          throw new AppError('VALIDATION_ERROR', 'The parent account must be a group account', [
            { field: 'parentId', message: 'not_a_group' },
          ]);
        }
        // children take the parent's type (the trigger does the same)
        type = parent.type;
      }
      const id = await accounts.insert({
        parentId: input.parentId ?? null,
        code: input.code,
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        type,
        isPosting: input.isPosting ?? true,
      });
      return accounts.get(id);
    });
  }

  updateAccount(
    ctx: RequestContext,
    id: string,
    input: UpdateGlAccountInput
  ): Promise<GlAccountView> {
    assertPermission(ctx, PERMISSIONS_002.ACCOUNTS_MANAGE);
    return this.deps.run(ctx, async ({ accounts }) => {
      await accounts.get(id);
      await accounts.update(id, input.expectedVersion, {
        ...(input.nameAr !== undefined ? { name_ar: input.nameAr } : {}),
        ...(input.nameEn !== undefined ? { name_en: input.nameEn } : {}),
        ...(input.isPosting !== undefined ? { is_posting: input.isPosting } : {}),
        ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
      });
      return accounts.get(id);
    });
  }

  /** DELETE /gl-accounts/:id — refused once anything refers to it (deactivate instead). */
  deleteAccount(ctx: RequestContext, id: string): Promise<void> {
    assertPermission(ctx, PERMISSIONS_002.ACCOUNTS_MANAGE);
    return this.deps.run(ctx, async ({ accounts }) => {
      const account = await accounts.get(id);
      if (account.inUse) {
        throw new AppError('ACCOUNT_IN_USE', 'The account is in use; deactivate it instead', {
          accountId: id,
          code: account.code,
        });
      }
      try {
        await accounts.delete(id);
      } catch (err) {
        if ((err as { code?: string }).code === '23503') {
          throw new AppError('ACCOUNT_IN_USE', 'The account is in use; deactivate it instead', {
            accountId: id,
            code: account.code,
          });
        }
        throw err;
      }
    });
  }

  // --- mappings ------------------------------------------------------------------------------

  categoryMappings(ctx: RequestContext): Promise<CategoryMappingView[]> {
    return this.deps.run(ctx, ({ mappings }) => mappings.mappings());
  }

  setCategoryMappings(
    ctx: RequestContext,
    input: CategoryMappingInput
  ): Promise<CategoryMappingView[]> {
    assertPermission(ctx, PERMISSIONS_002.ACCOUNTS_MANAGE);
    return this.deps.run(ctx, async (repos) => {
      for (const [i, m] of input.mappings.entries()) {
        await assertPostingAccount(
          repos,
          m.expenseAccountId,
          `mappings.${i}.expenseAccountId`,
          'expense'
        );
        await repos.mappings.upsert(m.category, m.expenseAccountId);
      }
      return repos.mappings.mappings();
    });
  }

  budgetLineAccounts(ctx: RequestContext, grantId: string): Promise<BudgetLineAccountView[]> {
    return this.deps.run(ctx, ({ mappings }) => mappings.budgetLines(grantId));
  }

  /** PATCH /budget-lines/:id/expense-account — null falls back to the category default. */
  setBudgetLineAccount(
    ctx: RequestContext,
    budgetLineId: string,
    input: BudgetLineExpenseAccountInput
  ): Promise<void> {
    assertPermission(ctx, PERMISSIONS_002.ACCOUNTS_MANAGE);
    return this.deps.run(ctx, async (repos) => {
      if (input.expenseAccountId) {
        await assertPostingAccount(repos, input.expenseAccountId, 'expenseAccountId', 'expense');
      }
      await repos.mappings.setBudgetLineAccount(budgetLineId, input.expenseAccountId);
    });
  }

  controlAccounts(ctx: RequestContext): Promise<ControlAccountView[]> {
    return this.deps.run(ctx, ({ controls }) => controls.list());
  }

  setControlAccounts(
    ctx: RequestContext,
    input: ControlAccountsInput
  ): Promise<ControlAccountView[]> {
    assertPermission(ctx, PERMISSIONS_002.ACCOUNTS_MANAGE);
    return this.deps.run(ctx, async (repos) => {
      for (const [i, s] of input.settings.entries()) {
        await assertPostingAccount(repos, s.accountId, `settings.${i}.accountId`);
        await repos.controls.upsert(s.key, s.grantId ?? null, s.accountId);
      }
      return repos.controls.list();
    });
  }

  // --- bank accounts and cash boxes ----------------------------------------------------------

  createMoneyAccount(
    ctx: RequestContext,
    kind: 'bank' | 'cash',
    input: CreateBankAccountInput | CreateCashBoxInput
  ): Promise<MoneyAccountView> {
    assertPermission(ctx, PERMISSIONS_002.BANK_MANAGE);
    return this.deps.run(ctx, async (repos) => {
      await assertPostingAccount(repos, input.glAccountId, 'glAccountId', 'asset');
      const bank = kind === 'bank' ? (input as CreateBankAccountInput) : null;
      const cash = kind === 'cash' ? (input as CreateCashBoxInput) : null;
      const id = await repos.money.insert({
        kind,
        name: input.name,
        bankName: bank?.bankName ?? null,
        branch: bank?.branch ?? null,
        accountNo: bank?.accountNo ?? null,
        currency: input.currency,
        officeId: input.officeId,
        glAccountId: input.glAccountId,
        custodianUserId: cash?.custodianUserId ?? null,
        openingBalance: input.openingBalance ?? '0',
        openingDate: input.openingDate ?? null,
      });
      return repos.money.get(id);
    });
  }

  updateMoneyAccount(
    ctx: RequestContext,
    kind: 'bank' | 'cash',
    id: string,
    input: UpdateMoneyAccountInput
  ): Promise<MoneyAccountView> {
    assertPermission(ctx, PERMISSIONS_002.BANK_MANAGE);
    return this.deps.run(ctx, async ({ money }) => {
      const account = await money.get(id);
      if (account.kind !== kind) throw new AppError('NOT_FOUND', 'Bank or cash account not found');
      await money.update(id, input.expectedVersion, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(kind === 'bank' && input.bankName !== undefined ? { bank_name: input.bankName } : {}),
        ...(kind === 'bank' && input.branch !== undefined ? { branch: input.branch } : {}),
        ...(kind === 'bank' && input.accountNo !== undefined
          ? { account_no: input.accountNo }
          : {}),
        ...(kind === 'cash' && input.custodianUserId !== undefined
          ? { custodian_user_id: input.custodianUserId }
          : {}),
        ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
      });
      return money.get(id);
    });
  }
}
