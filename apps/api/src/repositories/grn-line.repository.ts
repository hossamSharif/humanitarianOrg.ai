// grn_line (data-model §5): delivered = accepted + rejected per PO line, a reason for rejected
// quantities, an optional return date and the Asset flag (FR-040, FR-042). The trigger keeps
// each line on a line of the GRN's PO and the quantities fixed after completion.
import type { GrnLineInput, GrnLineView } from '@ngo/shared';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

type Json = Parameters<TxSql['json']>[0];

export class GrnLineRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async insertMany(grnId: string, lines: readonly GrnLineInput[]): Promise<void> {
    const sql = this.sql;
    const rows = lines.map((l) => ({
      poLineId: l.poLineId,
      deliveredQty: l.deliveredQty,
      acceptedQty: l.acceptedQty,
      rejectedQty: l.rejectedQty ?? '0',
      rejectReason: l.rejectReason ?? null,
      conditionRemarks: l.conditionRemarks ?? null,
      isAsset: l.isAsset ?? false,
    }));
    await sql`
      insert into public.grn_line
        (tenant_id, grn_id, po_line_id, delivered_qty, accepted_qty, rejected_qty,
         reject_reason, condition_remarks, is_asset)
      select ${this.tenantId}, ${grnId}, x."poLineId", x."deliveredQty", x."acceptedQty",
             x."rejectedQty", x."rejectReason", x."conditionRemarks", x."isAsset"
      from jsonb_to_recordset(${sql.json(rows as unknown as Json)}) as x (
        "poLineId" uuid, "deliveredQty" numeric, "acceptedQty" numeric, "rejectedQty" numeric,
        "rejectReason" text, "conditionRemarks" text, "isAsset" boolean
      )`;
  }

  async list(grnId: string): Promise<GrnLineView[]> {
    const rows = await this.sql<
      {
        id: string;
        po_line_id: string;
        line_no: number;
        description: string | null;
        ordered_qty: string;
        delivered_qty: string;
        accepted_qty: string;
        rejected_qty: string;
        reject_reason: string | null;
        returned_on: string | null;
        condition_remarks: string | null;
        is_asset: boolean;
      }[]
    >`
      select gl.id, gl.po_line_id, o.line_no, o.description, o.quantity::text as ordered_qty,
             gl.delivered_qty::text, gl.accepted_qty::text, gl.rejected_qty::text,
             gl.reject_reason, gl.returned_on::text, gl.condition_remarks, gl.is_asset
      from public.grn_line gl
      join public.po_line o on o.id = gl.po_line_id
      where gl.tenant_id = ${this.tenantId} and gl.grn_id = ${grnId}
      order by o.line_no`;
    return rows.map((r) => ({
      id: r.id,
      poLineId: r.po_line_id,
      lineNo: r.line_no,
      description: r.description,
      orderedQty: r.ordered_qty,
      deliveredQty: r.delivered_qty,
      acceptedQty: r.accepted_qty,
      rejectedQty: r.rejected_qty,
      rejectReason: r.reject_reason,
      returnedOn: r.returned_on,
      conditionRemarks: r.condition_remarks,
      isAsset: r.is_asset,
    }));
  }

  /** Records the return of the rejected quantity (once). */
  async setReturned(grnId: string, lineId: string, returnedOn: string): Promise<void> {
    const rows = await this.sql`
      update public.grn_line set returned_on = ${returnedOn}
      where tenant_id = ${this.tenantId} and grn_id = ${grnId} and id = ${lineId}
        and rejected_qty > 0 and returned_on is null
      returning id`;
    if (rows.length === 0) {
      throw new AppError('INVALID_STATE', 'Only a rejected quantity not yet returned can be returned');
    }
  }
}
