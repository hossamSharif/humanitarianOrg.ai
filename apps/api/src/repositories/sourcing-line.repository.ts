// sourcing_line: one line per PR line (data-model §4). Quantity and unit are copied from the PR
// line by trigger and stay read-only; only the wording may change (FR-015). The partial unique
// index on open lines keeps one open event per PR line (BR-22).
import type { SourcingLineView } from '@ngo/shared';
import type { TxSql } from '../db/tx';

interface Row {
  id: string;
  line_no: number;
  pr_line_id: string;
  pr_id: string;
  pr_number: string | null;
  description: string | null;
  specifications: string | null;
  quantity: string;
  unit_id: string | null;
  unit_code: string | null;
  lot_id: string | null;
  estimated_total: string | null;
  estimated_currency: string;
}

export interface NewSourcingLine {
  prLineId: string;
  description: string | null;
  specifications: string | null;
}

export class SourcingLineRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async list(eventId: string): Promise<SourcingLineView[]> {
    const rows = await this.sql<Row[]>`
      select s.id, s.line_no, s.pr_line_id, l.pr_id, p.number as pr_number, s.description,
             s.specifications, s.quantity::text, s.unit_id, u.code as unit_code, s.lot_id,
             l.line_total::text as estimated_total, l.currency::text as estimated_currency
      from public.sourcing_line s
      join public.pr_line l on l.id = s.pr_line_id
      join public.purchase_requisition p on p.id = l.pr_id
      left join public.unit_of_measure u on u.id = s.unit_id
      where s.tenant_id = ${this.tenantId} and s.sourcing_event_id = ${eventId}
      order by s.line_no`;
    return rows.map((r) => ({
      id: r.id,
      lineNo: r.line_no,
      prLineId: r.pr_line_id,
      prId: r.pr_id,
      prNumber: r.pr_number,
      description: r.description,
      specifications: r.specifications,
      quantity: r.quantity,
      unitId: r.unit_id,
      unitCode: r.unit_code,
      lotId: r.lot_id,
      estimatedTotal: r.estimated_total ?? '0.00',
      estimatedCurrency: r.estimated_currency,
    }));
  }

  /** Lines numbered 1..n in the given order; quantity and unit come from the PR line. */
  async insertMany(eventId: string, lines: readonly NewSourcingLine[]): Promise<void> {
    if (lines.length === 0) return;
    const sql = this.sql;
    // quantity is filled by the guard trigger from the PR line; 1 satisfies the check first
    await sql`
      insert into public.sourcing_line ${sql(
        lines.map((l, i) => ({
          tenant_id: this.tenantId,
          sourcing_event_id: eventId,
          line_no: i + 1,
          pr_line_id: l.prLineId,
          description: l.description,
          specifications: l.specifications,
          quantity: 1,
        }))
      )}`;
  }

  async reword(
    eventId: string,
    id: string,
    values: { description?: string | null; specifications?: string | null }
  ): Promise<boolean> {
    const changes: Record<string, unknown> = {};
    if (values.description !== undefined) changes.description = values.description;
    if (values.specifications !== undefined) changes.specifications = values.specifications;
    if (Object.keys(changes).length === 0) return true;
    const sql = this.sql;
    const rows = await sql`
      update public.sourcing_line set ${sql(changes)}
      where tenant_id = ${this.tenantId} and sourcing_event_id = ${eventId} and id = ${id}
      returning id`;
    return rows.length > 0;
  }

  async prLineIds(eventId: string): Promise<string[]> {
    const rows = await this.sql<{ pr_line_id: string }[]>`
      select pr_line_id from public.sourcing_line
      where tenant_id = ${this.tenantId} and sourcing_event_id = ${eventId}
      order by line_no`;
    return rows.map((r) => r.pr_line_id);
  }
}
