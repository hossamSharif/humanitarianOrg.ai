// budget_commitment as seen from a PR: the holds it placed per budget line and cycle, with the
// grant currency. Writes go through BudgetService and BudgetTxRepository (budget-line.repository).
import type { PrReservation } from '@ngo/shared';
import type { TxSql } from '../db/tx';

export interface BudgetCommitmentStore {
  listForPr(prId: string): Promise<PrReservation[]>;
}

export class BudgetCommitmentRepository implements BudgetCommitmentStore {
  constructor(private readonly sql: TxSql) {}

  async listForPr(prId: string): Promise<PrReservation[]> {
    const rows = await this.sql<
      {
        budget_line_id: string;
        cycle: number;
        amount: string;
        currency: string;
        status: PrReservation['status'];
      }[]
    >`
      select c.budget_line_id, c.cycle, c.amount::text as amount, g.currency::text as currency,
             c.status
      from public.budget_commitment c
      join public.budget_line b on b.id = c.budget_line_id
      join public."grant" g on g.id = b.grant_id
      where c.pr_id = ${prId}
      order by c.cycle, c.budget_line_id`;
    return rows.map((r) => ({
      budgetLineId: r.budget_line_id,
      cycle: r.cycle,
      amount: r.amount,
      currency: r.currency,
      status: r.status,
    }));
  }
}
