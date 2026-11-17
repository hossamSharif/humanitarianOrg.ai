// Accounting setup (002 US12; contracts/rest-api.md "Accounting"; data-model §6, research D5,
// R33): chart of accounts, budget-category and budget-line expense mappings, control accounts,
// bank accounts and cash boxes, and accounting periods. Bodies are `.strict()`.
import { z } from 'zod';
import type { AccountingPeriodStatus } from '../doc-types';
import { budgetCategory, type BudgetCategory } from './budget-line';
import { currencyCode, expectedVersion, isoDate, moneyString, uuid } from './common';

export const GL_ACCOUNT_TYPES = [
  'asset',
  'liability',
  'fund_balance',
  'income',
  'expense',
] as const;
export type GlAccountType = (typeof GL_ACCOUNT_TYPES)[number];

export const CONTROL_ACCOUNT_KEYS = [
  'staff_advances',
  'supplier_advances',
  'retention_payable',
  'grant_funds_received',
  'exchange_gain_loss',
  'opening_balance_equity',
  'suspense',
] as const;
export type ControlAccountKey = (typeof CONTROL_ACCOUNT_KEYS)[number];

const accountCode = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z.-]{1,20}$/, 'Letters, digits, dots and dashes, at most 20');
const name = z.string().trim().min(1).max(200);

/** POST /gl-accounts — a child takes its parent's type (the parent must be a group). */
export const createGlAccountBody = z
  .object({
    parentId: uuid.nullable().default(null),
    code: accountCode,
    nameAr: name,
    nameEn: name,
    type: z.enum(GL_ACCOUNT_TYPES),
    isPosting: z.boolean().default(true),
  })
  .strict();
export type CreateGlAccountInput = z.input<typeof createGlAccountBody>;

/** PATCH /gl-accounts/:id — names, posting flag, active flag (deactivate instead of delete). */
export const updateGlAccountBody = z
  .object({
    expectedVersion,
    nameAr: name.optional(),
    nameEn: name.optional(),
    isPosting: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateGlAccountInput = z.input<typeof updateGlAccountBody>;

export const glAccountListQuery = z.object({
  type: z.enum(GL_ACCOUNT_TYPES).optional(),
  postingOnly: z.coerce.boolean().default(false),
  includeInactive: z.coerce.boolean().default(true),
});
export type GlAccountListQuery = z.infer<typeof glAccountListQuery>;

/** PUT /gl-accounts/category-mapping — the default expense account per budget category. */
export const categoryMappingBody = z
  .object({
    mappings: z
      .array(z.object({ category: budgetCategory, expenseAccountId: uuid }).strict())
      .max(20),
  })
  .strict()
  .refine((b) => new Set(b.mappings.map((m) => m.category)).size === b.mappings.length, {
    message: 'Each category appears once',
    path: ['mappings'],
  });
export type CategoryMappingInput = z.input<typeof categoryMappingBody>;

/** PUT /control-accounts — `grantId` only for grant_funds_received. */
export const controlAccountsBody = z
  .object({
    settings: z
      .array(
        z
          .object({
            key: z.enum(CONTROL_ACCOUNT_KEYS),
            grantId: uuid.nullable().default(null),
            accountId: uuid,
          })
          .strict()
          .refine((s) => s.grantId === null || s.key === 'grant_funds_received', {
            message: 'Only the grant funds received account is set per grant',
            path: ['grantId'],
          })
      )
      .max(200),
  })
  .strict()
  .refine(
    (b) => new Set(b.settings.map((s) => `${s.key}:${s.grantId ?? ''}`)).size === b.settings.length,
    { message: 'Each key (and grant) appears once', path: ['settings'] }
  );
export type ControlAccountsInput = z.input<typeof controlAccountsBody>;

/** PATCH /budget-lines/:id/expense-account — null falls back to the category mapping. */
export const budgetLineExpenseAccountBody = z
  .object({ expenseAccountId: uuid.nullable() })
  .strict();
export type BudgetLineExpenseAccountInput = z.input<typeof budgetLineExpenseAccountBody>;

const moneyAccountFields = {
  name,
  currency: currencyCode,
  officeId: uuid,
  glAccountId: uuid,
  openingBalance: moneyString.default('0'),
  openingDate: isoDate.nullable().default(null),
};

/** POST /bank-accounts */
export const createBankAccountBody = z
  .object({
    ...moneyAccountFields,
    bankName: z.string().trim().min(1).max(200),
    branch: z.string().trim().max(200).nullable().default(null),
    accountNo: z.string().trim().min(1).max(100),
  })
  .strict();
export type CreateBankAccountInput = z.input<typeof createBankAccountBody>;

/** POST /cash-boxes */
export const createCashBoxBody = z
  .object({ ...moneyAccountFields, custodianUserId: uuid.nullable().default(null) })
  .strict();
export type CreateCashBoxInput = z.input<typeof createCashBoxBody>;

/** PATCH /bank-accounts/:id, /cash-boxes/:id — the currency and ledger account stay. */
export const updateMoneyAccountBody = z
  .object({
    expectedVersion,
    name: name.optional(),
    bankName: z.string().trim().min(1).max(200).optional(),
    branch: z.string().trim().max(200).nullable().optional(),
    accountNo: z.string().trim().min(1).max(100).optional(),
    custodianUserId: uuid.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateMoneyAccountInput = z.input<typeof updateMoneyAccountBody>;

/** POST /periods */
export const createPeriodBody = z
  .object({
    year: z.number().int().min(2000).max(2999),
    month: z.number().int().min(1).max(12),
  })
  .strict();
export type CreatePeriodInput = z.input<typeof createPeriodBody>;

/** POST /periods/:id/close — the first call warns about unposted approved vouchers (FR-065). */
export const closePeriodBody = z
  .object({ expectedVersion, confirm: z.boolean().default(false) })
  .strict();
export type ClosePeriodInput = z.input<typeof closePeriodBody>;

/** POST /periods/:id/reopen — a missing reason is 422 REASON_REQUIRED (US12-4). */
export const reopenPeriodBody = z
  .object({ expectedVersion, reason: z.string().trim().max(2000).optional() })
  .strict();
export type ReopenPeriodInput = z.input<typeof reopenPeriodBody>;

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export interface GlAccountView {
  id: string;
  parentId: string | null;
  code: string;
  nameAr: string;
  nameEn: string;
  type: GlAccountType;
  isPosting: boolean;
  isActive: boolean;
  version: number;
  /** referenced by vouchers, mappings, money accounts or deductions: delete is refused */
  inUse: boolean;
}

export interface CategoryMappingView {
  category: BudgetCategory;
  expenseAccountId: string | null;
  accountCode: string | null;
}

export interface ControlAccountView {
  key: ControlAccountKey;
  grantId: string | null;
  grantCode: string | null;
  accountId: string;
  accountCode: string;
}

export interface BudgetLineAccountView {
  budgetLineId: string;
  code: string;
  description: string;
  category: BudgetCategory;
  expenseAccountId: string | null;
  /** coalesce(budget line account, category default) */
  resolvedAccountId: string | null;
  resolvedAccountCode: string | null;
}

export interface AccountingPeriodView {
  id: string;
  year: number;
  month: number;
  status: AccountingPeriodStatus;
  closedAt: string | null;
  closedBy: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenReason: string | null;
  version: number;
}

export interface UnpostedVoucherView {
  id: string;
  type: string;
  number: string | null;
  voucherDate: string;
  amount: string;
  currency: string;
}

/** POST /periods/:id/close */
export type ClosePeriodResult =
  | { requiresConfirmation: true; unpostedApproved: UnpostedVoucherView[] }
  | { requiresConfirmation: false; period: AccountingPeriodView };
