// payment_request_line (002 data-model §7): the lines of a request with their match result. On
// PO requests the grant, budget line, location and activity are re-copied from the PO line by
// trigger (app.payment_request_line_inherit), so the values written here only satisfy not null.
import type { ChargeToRow, MatchResult, PaymentRequestLineView } from '@ngo/shared';
import type { TxSql } from '../db/tx';

type Json = Parameters<TxSql['json']>[0];

export interface NewPaymentRequestLine {
  poLineId: string | null;
  grnLineId: string | null;
  certificateId: string | null;
  description: string | null;
  quantity: string | null;
  unitPrice: string | null;
  gross: string;
  grantId: string;
  budgetLineId: string;
  locationOfficeId: string | null;
  activityId: string | null;
  invoicedQty: string | null;
  acceptedQty: string | null;
  poPrice: string | null;
  matchResult: MatchResult | null;
  amountGrant: string | null;
}

export class PaymentRequestLineRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  /** Replaces every line (a draft is recomputed as a whole). */
  async replace(requestId: string, lines: readonly NewPaymentRequestLine[]): Promise<void> {
    const sql = this.sql;
    await sql`
      delete from public.payment_request_line
      where tenant_id = ${this.tenantId} and payment_request_id = ${requestId}`;
    if (lines.length === 0) return;
    const rows = lines.map((l, i) => ({ ...l, lineNo: i + 1 }));
    await sql`
      insert into public.payment_request_line
        (tenant_id, payment_request_id, line_no, po_line_id, grn_line_id, certificate_id,
         description, quantity, unit_price, gross, grant_id, budget_line_id, location_office_id,
         activity_id, invoiced_qty, accepted_qty, po_price, match_result, amount_grant)
      select ${this.tenantId}, ${requestId}, x."lineNo", x."poLineId", x."grnLineId",
             x."certificateId", x.description, x.quantity, x."unitPrice", x.gross, x."grantId",
             x."budgetLineId", x."locationOfficeId", x."activityId", x."invoicedQty",
             x."acceptedQty", x."poPrice", x."matchResult", x."amountGrant"
      from jsonb_to_recordset(${sql.json(rows as unknown as Json)}) as x (
        "lineNo" smallint, "poLineId" uuid, "grnLineId" uuid, "certificateId" uuid,
        description text, quantity numeric, "unitPrice" numeric, gross numeric, "grantId" uuid,
        "budgetLineId" uuid, "locationOfficeId" uuid, "activityId" uuid, "invoicedQty" numeric,
        "acceptedQty" numeric, "poPrice" numeric, "matchResult" text, "amountGrant" numeric
      )`;
  }

  async list(requestId: string): Promise<PaymentRequestLineView[]> {
    const rows = await this.sql<
      {
        id: string;
        line_no: number;
        po_line_id: string | null;
        description: string | null;
        quantity: string | null;
        unit_price: string | null;
        gross: string;
        budget_line_id: string;
        budget_line_code: string;
        location_office_id: string | null;
        activity_id: string | null;
        invoiced_qty: string | null;
        accepted_qty: string | null;
        po_price: string | null;
        match_result: MatchResult | null;
        amount_grant: string | null;
      }[]
    >`
      select l.id, l.line_no, l.po_line_id, l.description, l.quantity::text, l.unit_price::text,
             l.gross::text, l.budget_line_id, b.code as budget_line_code, l.location_office_id,
             l.activity_id, l.invoiced_qty::text, l.accepted_qty::text, l.po_price::text,
             l.match_result, l.amount_grant::text
      from public.payment_request_line l
      join public.budget_line b on b.id = l.budget_line_id
      where l.tenant_id = ${this.tenantId} and l.payment_request_id = ${requestId}
      order by l.line_no`;
    return rows.map((r) => ({
      id: r.id,
      lineNo: r.line_no,
      poLineId: r.po_line_id,
      description: r.description,
      quantity: r.quantity,
      unitPrice: r.unit_price,
      gross: r.gross,
      budgetLineId: r.budget_line_id,
      budgetLineCode: r.budget_line_code,
      locationOfficeId: r.location_office_id,
      activityId: r.activity_id,
      invoicedQty: r.invoiced_qty,
      acceptedQty: r.accepted_qty,
      poPrice: r.po_price,
      matchResult: r.match_result,
      amountGrant: r.amount_grant,
    }));
  }

  /** The charge-to table: Σ per budget line × location × activity (FR-058). */
  async chargeTo(requestId: string): Promise<ChargeToRow[]> {
    const rows = await this.sql<
      {
        budget_line_id: string;
        code: string;
        location_office_id: string | null;
        activity_id: string | null;
        gross: string;
        amount_grant: string | null;
      }[]
    >`
      select l.budget_line_id, b.code, l.location_office_id, l.activity_id,
             sum(l.gross)::text as gross, sum(l.amount_grant)::text as amount_grant
      from public.payment_request_line l
      join public.budget_line b on b.id = l.budget_line_id
      where l.tenant_id = ${this.tenantId} and l.payment_request_id = ${requestId}
      group by l.budget_line_id, b.code, l.location_office_id, l.activity_id
      order by b.code`;
    return rows.map((r) => ({
      budgetLineId: r.budget_line_id,
      budgetLineCode: r.code,
      locationOfficeId: r.location_office_id,
      activityId: r.activity_id,
      gross: r.gross,
      amountGrant: r.amount_grant,
    }));
  }
}
