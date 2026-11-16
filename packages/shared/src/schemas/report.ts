// Budget status report (contracts/rest-api.md "Reports", FR-049, SC-004): per budget line
// Budget / Reserved / Committed / Actual / Available / % used with grant totals, drill-down to
// the reserving and committing PRs, and the Excel export. All amounts are decimal strings in the
// grant currency.
import { z } from 'zod';
import type { PrStatus } from '../pr-state';
import type { BudgetCategory, BudgetFigures } from './budget-line';
import { uuid } from './common';
import { printLocale } from './print';

export const budgetStatusQuery = z.object({ grantId: uuid });
export type BudgetStatusQuery = z.infer<typeof budgetStatusQuery>;

export const budgetStatusExportQuery = budgetStatusQuery.extend({
  locale: printLocale.default('ar'),
});
export type BudgetStatusExportQuery = z.infer<typeof budgetStatusExportQuery>;

export const budgetDrillDownParams = z.object({ budgetLineId: uuid });
export const budgetDrillDownQuery = z.object({
  /** omitted = both */
  status: z.enum(['reserved', 'committed']).optional(),
});
export type BudgetDrillDownQuery = z.infer<typeof budgetDrillDownQuery>;

export interface BudgetStatusRow extends BudgetFigures {
  budgetLineId: string;
  code: string;
  description: string;
  category: BudgetCategory;
  isActive: boolean;
}

export interface BudgetStatusReport {
  grant: {
    id: string;
    code: string;
    name: string;
    currency: string;
    status: 'active' | 'suspended' | 'closed';
    totalAmount: string;
    startDate: string;
    endDate: string;
    donorName: string | null;
  };
  lines: BudgetStatusRow[];
  totals: BudgetFigures;
  /** grant total − Σ budget lines (FR-013 warning when ≠ 0) */
  difference: string;
  generatedAt: string;
}

/** One open reservation or commitment of a budget line. */
export interface BudgetDrillDownRow {
  commitmentId: string;
  prId: string;
  /** null when the PR is outside the caller's offices (RLS); the amount still counts */
  number: string | null;
  prStatus: PrStatus | null;
  prDate: string | null;
  officeCode: string | null;
  requesterName: string | null;
  status: 'reserved' | 'committed';
  amount: string;
  currency: string;
  /** reserved_at or committed_at */
  at: string;
}

export interface BudgetDrillDown {
  budgetLine: { id: string; code: string; description: string; currency: string };
  data: BudgetDrillDownRow[];
  total: string;
}
