// Budget lines. The donor's code is free text kept exactly as entered ('10202', '2.2.31', '010').
import { z } from 'zod';
import { expectedVersion, moneyString, uuid } from './common';

export const BUDGET_CATEGORIES = [
  'supplies',
  'services',
  'staff',
  'equipment',
  'running_costs',
] as const;
export const budgetCategory = z.enum(BUDGET_CATEGORIES);
export type BudgetCategory = z.infer<typeof budgetCategory>;

export const budgetLineCode = z.string().trim().min(1).max(100);

export const budgetLineCreate = z.object({
  code: budgetLineCode,
  description: z.string().trim().min(1).max(1000),
  category: budgetCategory,
  budgetAmount: moneyString,
  officeId: uuid.nullable().optional(),
});

export const budgetLineUpdate = budgetLineCreate
  .partial()
  .extend({ isActive: z.boolean().optional(), expectedVersion });

export type BudgetLineCreate = z.infer<typeof budgetLineCreate>;
export type BudgetLineUpdate = z.infer<typeof budgetLineUpdate>;

export interface BudgetLine {
  id: string;
  grantId: string;
  code: string;
  description: string;
  category: BudgetCategory;
  budgetAmount: string;
  officeId: string | null;
  isActive: boolean;
  version: number;
}

/** Derived figures, all decimal strings in the grant currency (FR-012). */
export interface BudgetFigures {
  budget: string;
  reserved: string;
  committed: string;
  actual: string;
  available: string;
  /** percent with 2 decimals; null when the budget is 0 */
  pctUsed: string | null;
}

export type BudgetLineWithBalance = BudgetLine & BudgetFigures & { currency: string };

export interface GrantBudgetSummary {
  currency: string;
  totalAmount: string;
  budgetLinesTotal: string;
  difference: string;
  /** FR-013: show a warning, never block */
  hasDifference: boolean;
  totals: BudgetFigures;
}

export interface BudgetLineListResponse {
  data: BudgetLineWithBalance[];
  page: number;
  pageSize: number;
  total: number;
  summary: GrantBudgetSummary;
}
