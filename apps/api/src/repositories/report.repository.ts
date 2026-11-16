// Reads of the budget status report (FR-049, SC-004). Figures come from the
// budget_line_balance view (security_invoker, so the caller's RLS applies); the drill-down joins
// open commitments to their PRs, whose office-scoped RLS may hide the PR but never the amount.
import type { BudgetCategory, BudgetDrillDownRow, BudgetStatusReport } from '@ngo/shared';
import type { TxSql } from '../db/tx';

export interface ReportGrant extends Omit<BudgetStatusReport['grant'], 'currency'> {
  currency: string;
  timeZone: string;
}

export interface ReportLine {
  budgetLineId: string;
  code: string;
  description: string;
  category: BudgetCategory;
  isActive: boolean;
  budget: string;
  reserved: string;
  committed: string;
  actual: string;
}

export interface ReportBudgetLine {
  id: string;
  code: string;
  description: string;
  currency: string;
}

export interface ReportStore {
  grant(grantId: string): Promise<ReportGrant | null>;
  lines(grantId: string): Promise<ReportLine[]>;
  budgetLine(id: string): Promise<ReportBudgetLine | null>;
  commitments(
    budgetLineId: string,
    statuses: readonly ('reserved' | 'committed')[]
  ): Promise<Omit<BudgetDrillDownRow, 'currency'>[]>;
}

export class ReportRepository implements ReportStore {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async grant(grantId: string): Promise<ReportGrant | null> {
    const [row] = await this.sql<ReportGrant[]>`
      select g.id, g.code, g.name, g.currency::text as currency, g.status,
             g.total_amount::text as "totalAmount", g.start_date::text as "startDate",
             g.end_date::text as "endDate", d.name as "donorName", t.timezone as "timeZone"
      from public."grant" g
      join public.tenant t on t.id = g.tenant_id
      left join public.donor d on d.id = g.donor_id
      where g.tenant_id = ${this.tenantId} and g.id = ${grantId}`;
    return row ?? null;
  }

  async lines(grantId: string): Promise<ReportLine[]> {
    return this.sql<ReportLine[]>`
      select b.id as "budgetLineId", b.code, b.description, b.category, b.is_active as "isActive",
             v.budget::text as budget, v.reserved::text as reserved,
             v.committed::text as committed, v.actual::text as actual
      from public.budget_line b
      join public.budget_line_balance v on v.budget_line_id = b.id
      where b.tenant_id = ${this.tenantId} and b.grant_id = ${grantId}
      order by b.code`;
  }

  async budgetLine(id: string): Promise<ReportBudgetLine | null> {
    const [row] = await this.sql<ReportBudgetLine[]>`
      select b.id, b.code, b.description, g.currency::text as currency
      from public.budget_line b join public."grant" g on g.id = b.grant_id
      where b.tenant_id = ${this.tenantId} and b.id = ${id}`;
    return row ?? null;
  }

  async commitments(budgetLineId: string, statuses: readonly ('reserved' | 'committed')[]) {
    return this.sql<Omit<BudgetDrillDownRow, 'currency'>[]>`
      select c.id as "commitmentId", c.pr_id as "prId", p.number, p.status as "prStatus",
             p.pr_date::text as "prDate", o.code as "officeCode",
             p.requester_name as "requesterName", c.status, c.amount::text as amount,
             to_json(coalesce(c.committed_at, c.reserved_at))#>>'{}' as at
      from public.budget_commitment c
      left join public.purchase_requisition p on p.id = c.pr_id
      left join public.office o on o.id = p.requesting_office_id
      where c.tenant_id = ${this.tenantId} and c.budget_line_id = ${budgetLineId}
        and c.status in ${this.sql([...statuses])}
      order by coalesce(c.committed_at, c.reserved_at), p.number`;
  }
}
