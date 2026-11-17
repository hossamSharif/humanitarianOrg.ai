// budget_category_account and budget_line.expense_account_id (002 data-model §6): every budget
// line resolves its expense account as coalesce(budget line account, category default); null is
// BUDGET_LINE_UNMAPPED at voucher generation (US12-2). The expense-account trigger refuses
// anything but a posting account of type expense.
import {
  BUDGET_CATEGORIES,
  type BudgetCategory,
  type BudgetLineAccountView,
  type CategoryMappingView,
} from '@ngo/shared';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

export interface ResolvedExpenseAccount {
  budgetLineId: string;
  code: string;
  accountId: string | null;
}

export class BudgetCategoryAccountRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async mappings(): Promise<CategoryMappingView[]> {
    const rows = await this.sql<
      { category: BudgetCategory; expense_account_id: string; code: string }[]
    >`
      select m.category, m.expense_account_id, g.code
      from public.budget_category_account m
      join public.gl_account g on g.id = m.expense_account_id
      where m.tenant_id = ${this.tenantId}`;
    return BUDGET_CATEGORIES.map((category) => {
      const row = rows.find((r) => r.category === category);
      return {
        category,
        expenseAccountId: row?.expense_account_id ?? null,
        accountCode: row?.code ?? null,
      };
    });
  }

  async upsert(category: BudgetCategory, expenseAccountId: string): Promise<void> {
    await this.sql`
      insert into public.budget_category_account (tenant_id, category, expense_account_id)
      values (${this.tenantId}, ${category}, ${expenseAccountId})
      on conflict (tenant_id, category) do update
      set expense_account_id = excluded.expense_account_id, updated_at = now()`;
  }

  /** The grant's budget lines with their own and their resolved expense account. */
  async budgetLines(grantId: string): Promise<BudgetLineAccountView[]> {
    const rows = await this.sql<
      {
        id: string;
        code: string;
        description: string;
        category: BudgetCategory;
        expense_account_id: string | null;
        resolved_id: string | null;
        resolved_code: string | null;
      }[]
    >`
      select b.id, b.code, b.description, b.category, b.expense_account_id,
             g.id as resolved_id, g.code as resolved_code
      from public.budget_line b
      left join public.budget_category_account m
        on m.tenant_id = b.tenant_id and m.category = b.category
      left join public.gl_account g on g.id = coalesce(b.expense_account_id, m.expense_account_id)
      where b.tenant_id = ${this.tenantId} and b.grant_id = ${grantId}
      order by b.code`;
    return rows.map((r) => ({
      budgetLineId: r.id,
      code: r.code,
      description: r.description,
      category: r.category,
      expenseAccountId: r.expense_account_id,
      resolvedAccountId: r.resolved_id,
      resolvedAccountCode: r.resolved_code,
    }));
  }

  async setBudgetLineAccount(budgetLineId: string, expenseAccountId: string | null): Promise<void> {
    const rows = await this.sql`
      update public.budget_line set expense_account_id = ${expenseAccountId}
      where tenant_id = ${this.tenantId} and id = ${budgetLineId}
      returning id`;
    if (rows.length === 0) throw new AppError('NOT_FOUND', 'Budget line not found');
  }

  /** coalesce(budget line account, category default) for each line; null when unmapped. */
  async resolve(budgetLineIds: readonly string[]): Promise<ResolvedExpenseAccount[]> {
    if (budgetLineIds.length === 0) return [];
    const sql = this.sql;
    const rows = await sql<{ id: string; code: string; account_id: string | null }[]>`
      select b.id, b.code, coalesce(b.expense_account_id, m.expense_account_id) as account_id
      from public.budget_line b
      left join public.budget_category_account m
        on m.tenant_id = b.tenant_id and m.category = b.category
      where b.tenant_id = ${this.tenantId}
        and b.id = any (${sql.array([...new Set(budgetLineIds)])}::uuid[])`;
    return rows.map((r) => ({ budgetLineId: r.id, code: r.code, accountId: r.account_id }));
  }
}
