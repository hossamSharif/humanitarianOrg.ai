// award_line (data-model §4): sourcing line → winning offer, with the offer's quantity and unit
// price and the PR line's budget line, location and activity (BR-1, BR-2; the trigger refuses a
// mismatch and copies the supplier from the offer).
import type { AwardLineView } from '@ngo/shared';
import type { TxSql } from '../db/tx';

export interface NewAwardLine {
  sourcingLineId: string;
  offerId: string;
}

/** The awarded amount on one budget line in one offer currency. */
export interface AwardBudgetAmount {
  budgetLineId: string;
  amount: string;
  currency: string;
}

/** What the awarded PR lines committed on one budget line, in the grant currency. */
export interface AwardPrCommitment {
  budgetLineId: string;
  amountGrant: string;
  prLineIds: string[];
}

export class AwardLineRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  /**
   * Replaces the award lines from the recommendation. Quantity and unit price come from the
   * offer's (sealed) line prices — readable to the caller after the opening — and the
   * dimensions from the PR line. Returns how many lines were written.
   */
  async replace(analysisId: string, lines: readonly NewAwardLine[]): Promise<number> {
    const sql = this.sql;
    await sql`
      delete from public.award_line
      where tenant_id = ${this.tenantId} and bid_analysis_id = ${analysisId}`;
    if (lines.length === 0) return 0;
    const rows = await sql`
      insert into public.award_line
        (tenant_id, bid_analysis_id, sourcing_line_id, offer_id, supplier_id, quantity,
         unit_price, currency, budget_line_id, location_office_id, activity_id)
      select ${this.tenantId}, ${analysisId}, s.id, o.id, o.supplier_id, p.quantity,
             p.unit_price, t.currency, l.budget_line_id, l.location_office_id, l.activity_id
      from jsonb_to_recordset(${sql.json(lines as unknown as Parameters<TxSql['json']>[0])})
        as x ("sourcingLineId" uuid, "offerId" uuid)
      join public.sourcing_line s on s.id = x."sourcingLineId"
      join public.pr_line l on l.id = s.pr_line_id
      join public.offer o on o.id = x."offerId"
      join public.offer_terms t on t.offer_id = o.id
      join public.offer_line_price p on p.offer_id = o.id and p.sourcing_line_id = s.id
      returning id`;
    return rows.length;
  }

  async list(analysisId: string): Promise<AwardLineView[]> {
    const rows = await this.sql<
      {
        sourcing_line_id: string;
        line_no: number;
        description: string | null;
        offer_id: string;
        supplier_id: string;
        quantity: string;
        unit_price: string;
        currency: string;
        amount: string;
      }[]
    >`
      select a.sourcing_line_id, s.line_no, s.description, a.offer_id, a.supplier_id,
             a.quantity::text, a.unit_price::text, a.currency::text, a.amount::text
      from public.award_line a
      join public.sourcing_line s on s.id = a.sourcing_line_id
      where a.tenant_id = ${this.tenantId} and a.bid_analysis_id = ${analysisId}
      order by s.line_no`;
    return rows.map((r) => ({
      sourcingLineId: r.sourcing_line_id,
      lineNo: r.line_no,
      description: r.description,
      offerId: r.offer_id,
      supplierId: r.supplier_id,
      quantity: r.quantity,
      unitPrice: r.unit_price,
      currency: r.currency,
      amount: r.amount,
    }));
  }

  /** Per budget line and currency: the awarded amount (FR-030). */
  async byBudgetLine(analysisId: string): Promise<AwardBudgetAmount[]> {
    const rows = await this.sql<{ budget_line_id: string; currency: string; amount: string }[]>`
      select budget_line_id, currency::text, sum(amount)::text as amount
      from public.award_line
      where tenant_id = ${this.tenantId} and bid_analysis_id = ${analysisId}
      group by budget_line_id, currency
      order by budget_line_id, currency`;
    return rows.map((r) => ({
      budgetLineId: r.budget_line_id,
      amount: r.amount,
      currency: r.currency,
    }));
  }

  /** Per budget line: the awarded PR lines' locked grant-currency amounts (their commitment). */
  async prCommitments(analysisId: string): Promise<AwardPrCommitment[]> {
    const rows = await this.sql<
      { budget_line_id: string; amount_grant: string; pr_line_ids: string[] }[]
    >`
      select l.budget_line_id, coalesce(sum(l.amount_grant), 0)::text as amount_grant,
             array_agg(l.id) as pr_line_ids
      from public.award_line a
      join public.sourcing_line s on s.id = a.sourcing_line_id
      join public.pr_line l on l.id = s.pr_line_id
      where a.tenant_id = ${this.tenantId} and a.bid_analysis_id = ${analysisId}
      group by l.budget_line_id`;
    return rows.map((r) => ({
      budgetLineId: r.budget_line_id,
      amountGrant: r.amount_grant,
      prLineIds: r.pr_line_ids,
    }));
  }

  /** Awarded suppliers with their award/pay compliance (US2-1). */
  async supplierCompliance(
    analysisId: string
  ): Promise<
    { supplierId: string; status: string; vettingOverdue: boolean; expiredDoc: boolean }[]
  > {
    const rows = await this.sql<
      {
        supplier_id: string;
        status: string;
        vetting_overdue: boolean;
        has_expired_required_doc: boolean;
      }[]
    >`
      select distinct a.supplier_id, c.status, c.vetting_overdue, c.has_expired_required_doc
      from public.award_line a
      join public.supplier_compliance c on c.supplier_id = a.supplier_id
      where a.tenant_id = ${this.tenantId} and a.bid_analysis_id = ${analysisId}`;
    return rows.map((r) => ({
      supplierId: r.supplier_id,
      status: r.status,
      vettingOverdue: r.vetting_overdue,
      expiredDoc: r.has_expired_required_doc,
    }));
  }
}
