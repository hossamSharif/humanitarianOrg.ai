// po_line (data-model §5): copied from the award lines of one supplier, with the sourcing line,
// PR line, unit and the PR line's budget line, location and activity (BR-1, BR-2; the
// po_line_inherit trigger refuses anything else). The receipt and payment figures are
// maintained by the GRN and voucher commands.
import type { PoLineView } from '@ngo/shared';
import type { TxSql } from '../db/tx';

/** The PO amount on one budget line, in the PO currency. */
export interface PoBudgetAmount {
  budgetLineId: string;
  amount: string;
}

/** What the PR lines behind the PO committed on one PR × budget line, in the grant currency. */
export interface PoPrCommitment {
  prId: string;
  budgetLineId: string;
  amountGrant: string;
  prLineIds: string[];
}

/** A PO line under lock, with what completed GRNs accepted on it. */
export interface LockedPoLine {
  id: string;
  quantity: string;
  acceptedQty: string;
}

export class PoLineRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  /** Copies the supplier's award lines, in sourcing-line order. Returns the number of lines. */
  async insertFromAward(poId: string, analysisId: string, supplierId: string): Promise<number> {
    const rows = await this.sql`
      insert into public.po_line
        (tenant_id, po_id, line_no, award_line_id, sourcing_line_id, pr_line_id, description,
         quantity, unit_id, unit_price, budget_line_id, location_office_id, activity_id)
      select ${this.tenantId}, ${poId}, row_number() over (order by s.line_no)::smallint, a.id,
             s.id, l.id, coalesce(s.description, l.description), a.quantity, l.unit_id,
             a.unit_price, a.budget_line_id, a.location_office_id, a.activity_id
      from public.award_line a
      join public.sourcing_line s on s.id = a.sourcing_line_id
      join public.pr_line l on l.id = s.pr_line_id
      where a.tenant_id = ${this.tenantId} and a.bid_analysis_id = ${analysisId}
        and a.supplier_id = ${supplierId}
      returning id`;
    return rows.length;
  }

  async list(poId: string): Promise<PoLineView[]> {
    const rows = await this.sql<
      {
        id: string;
        line_no: number;
        award_line_id: string | null;
        sourcing_line_id: string | null;
        pr_line_id: string | null;
        pr_id: string | null;
        pr_number: string | null;
        description: string | null;
        quantity: string;
        unit_id: string | null;
        unit_name_ar: string | null;
        unit_name_en: string | null;
        unit_price: string;
        line_total: string;
        budget_line_id: string;
        budget_line_code: string;
        location_office_id: string | null;
        activity_id: string | null;
        amount_grant: string | null;
        accepted_qty: string;
        remaining_qty: string;
        invoiced_qty: string;
        paid_amount: string;
      }[]
    >`
      select o.id, o.line_no, o.award_line_id, o.sourcing_line_id, o.pr_line_id,
             pl.pr_id, p.number as pr_number, o.description, o.quantity::text, o.unit_id,
             u.name_ar as unit_name_ar, u.name_en as unit_name_en, o.unit_price::text,
             o.line_total::text, o.budget_line_id, b.code as budget_line_code,
             o.location_office_id, o.activity_id, o.amount_grant::text, o.accepted_qty::text,
             greatest(o.quantity - o.accepted_qty, 0)::text as remaining_qty,
             o.invoiced_qty::text, o.paid_amount::text
      from public.po_line o
      join public.budget_line b on b.id = o.budget_line_id
      left join public.unit_of_measure u on u.id = o.unit_id
      left join public.pr_line pl on pl.id = o.pr_line_id
      left join public.purchase_requisition p on p.id = pl.pr_id
      where o.tenant_id = ${this.tenantId} and o.po_id = ${poId}
      order by o.line_no`;
    return rows.map((r) => ({
      id: r.id,
      lineNo: r.line_no,
      awardLineId: r.award_line_id,
      sourcingLineId: r.sourcing_line_id,
      prLineId: r.pr_line_id,
      prId: r.pr_id,
      prNumber: r.pr_number,
      description: r.description,
      quantity: r.quantity,
      unitId: r.unit_id,
      unitNameAr: r.unit_name_ar,
      unitNameEn: r.unit_name_en,
      unitPrice: r.unit_price,
      lineTotal: r.line_total,
      budgetLineId: r.budget_line_id,
      budgetLineCode: r.budget_line_code,
      locationOfficeId: r.location_office_id,
      activityId: r.activity_id,
      amountGrant: r.amount_grant,
      acceptedQty: r.accepted_qty,
      remainingQty: r.remaining_qty,
      invoicedQty: r.invoiced_qty,
      paidAmount: r.paid_amount,
    }));
  }

  /** Per budget line: Σ line totals in the PO currency. */
  async byBudgetLine(poId: string): Promise<PoBudgetAmount[]> {
    const rows = await this.sql<{ budget_line_id: string; amount: string }[]>`
      select budget_line_id, sum(line_total)::text as amount
      from public.po_line
      where tenant_id = ${this.tenantId} and po_id = ${poId}
      group by budget_line_id
      order by budget_line_id`;
    return rows.map((r) => ({ budgetLineId: r.budget_line_id, amount: r.amount }));
  }

  /** Per PR × budget line: the ordered PR lines' locked grant-currency amounts. */
  async prCommitments(poId: string): Promise<PoPrCommitment[]> {
    const rows = await this.sql<
      { pr_id: string; budget_line_id: string; amount_grant: string; pr_line_ids: string[] }[]
    >`
      select l.pr_id, l.budget_line_id, coalesce(sum(l.amount_grant), 0)::text as amount_grant,
             array_agg(l.id order by l.line_no) as pr_line_ids
      from public.po_line o
      join public.pr_line l on l.id = o.pr_line_id
      where o.tenant_id = ${this.tenantId} and o.po_id = ${poId}
      group by l.pr_id, l.budget_line_id
      order by l.pr_id, l.budget_line_id`;
    return rows.map((r) => ({
      prId: r.pr_id,
      budgetLineId: r.budget_line_id,
      amountGrant: r.amount_grant,
      prLineIds: r.pr_line_ids,
    }));
  }

  /** Stamps each line's amount in the grant currency at the commit rate (half-up, 2 dp). */
  async setAmountGrant(poId: string, rateToGrant: string): Promise<void> {
    await this.sql`
      update public.po_line
      set amount_grant = round(line_total * ${rateToGrant}::numeric, 2)
      where tenant_id = ${this.tenantId} and po_id = ${poId}`;
  }

  /** The PO's lines `FOR UPDATE` in id order (receipt checks, research R24). */
  async lock(poId: string): Promise<LockedPoLine[]> {
    const rows = await this.sql<{ id: string; quantity: string; accepted_qty: string }[]>`
      select id, quantity::text, accepted_qty::text from public.po_line
      where tenant_id = ${this.tenantId} and po_id = ${poId}
      order by id
      for update`;
    return rows.map((r) => ({ id: r.id, quantity: r.quantity, acceptedQty: r.accepted_qty }));
  }
}
