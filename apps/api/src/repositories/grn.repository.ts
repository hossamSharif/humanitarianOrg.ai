// grn (data-model §5, research R24): numbered on creation, completed by the received and
// inspected signatures. Office and supplier are inherited from the PO by trigger
// (app.receipt_inherit) and never written here. Office scope comes from RLS.
import type { GrnSummary, ListResponse, ReceiptStatus, ShipmentType } from '@ngo/shared';
import type postgres from 'postgres';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

export interface GrnRecord extends GrnSummary {
  version: number;
  officeId: string;
  createdBy: string;
  deliveryNoteNo: string | null;
  supplierInvoiceNo: string | null;
  completedAt: string | null;
  cancelReason: string | null;
}

interface Row {
  id: string;
  number: string;
  status: ReceiptStatus;
  po_id: string;
  po_number: string | null;
  supplier_id: string;
  supplier_name_ar: string;
  supplier_name_en: string;
  received_date: string;
  shipment_type: ShipmentType;
  created_at: Date;
  version: number;
  office_id: string;
  created_by: string;
  delivery_note_no: string | null;
  supplier_invoice_no: string | null;
  completed_at: Date | null;
  cancel_reason: string | null;
  total_count?: number;
}

const toSummary = (r: Row): GrnSummary => ({
  id: r.id,
  number: r.number,
  status: r.status,
  poId: r.po_id,
  poNumber: r.po_number,
  supplierId: r.supplier_id,
  supplierNameAr: r.supplier_name_ar,
  supplierNameEn: r.supplier_name_en,
  receivedDate: r.received_date,
  shipmentType: r.shipment_type,
  createdAt: r.created_at.toISOString(),
});

const toRecord = (r: Row): GrnRecord => ({
  ...toSummary(r),
  version: r.version,
  officeId: r.office_id,
  createdBy: r.created_by,
  deliveryNoteNo: r.delivery_note_no,
  supplierInvoiceNo: r.supplier_invoice_no,
  completedAt: r.completed_at?.toISOString() ?? null,
  cancelReason: r.cancel_reason,
});

export interface NewGrn {
  number: string;
  poId: string;
  officeId: string;
  supplierId: string;
  receivedDate: string;
  deliveryNoteNo: string;
  supplierInvoiceNo: string | null;
  shipmentType: ShipmentType;
}

export class GrnRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  private select(where: postgres.PendingQuery<postgres.Row[]>, tail = this.sql``) {
    return this.sql<Row[]>`
      select g.id, g.number, g.status, g.po_id, p.number as po_number, g.supplier_id,
             s.legal_name_ar as supplier_name_ar, s.legal_name_en as supplier_name_en,
             g.received_date::text, g.shipment_type, g.created_at, g.version, g.office_id,
             g.created_by, g.delivery_note_no, g.supplier_invoice_no, g.completed_at,
             g.cancel_reason, count(*) over ()::int as total_count
      from public.grn g
      join public.purchase_order p on p.id = g.po_id
      join public.supplier s on s.id = g.supplier_id
      where g.tenant_id = ${this.tenantId} ${where}
      ${tail}`;
  }

  async list(filter: {
    page: number;
    pageSize: number;
    status?: ReceiptStatus;
    poId?: string;
  }): Promise<ListResponse<GrnSummary>> {
    const sql = this.sql;
    const { page, pageSize } = filter;
    const rows = await this.select(
      sql`${filter.status ? sql`and g.status = ${filter.status}` : sql``}
          ${filter.poId ? sql`and g.po_id = ${filter.poId}` : sql``}`,
      sql`order by g.created_at desc, g.id limit ${pageSize} offset ${(page - 1) * pageSize}`
    );
    return { data: rows.map(toSummary), page, pageSize, total: rows[0]?.total_count ?? 0 };
  }

  async find(id: string, options: { lock?: boolean } = {}): Promise<GrnRecord | null> {
    if (options.lock) {
      const [locked] = await this.sql<{ id: string }[]>`
        select id from public.grn where tenant_id = ${this.tenantId} and id = ${id} for update`;
      if (!locked) return null;
    }
    const [row] = await this.select(this.sql`and g.id = ${id}`);
    return row ? toRecord(row) : null;
  }

  async get(id: string, options: { lock?: boolean } = {}): Promise<GrnRecord> {
    const grn = await this.find(id, options);
    if (!grn) throw new AppError('NOT_FOUND', 'GRN not found');
    return grn;
  }

  /** Office and supplier are re-copied from the PO by trigger; the values satisfy not null. */
  async insert(values: NewGrn): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.grn
        (tenant_id, number, po_id, office_id, supplier_id, received_date, delivery_note_no,
         supplier_invoice_no, shipment_type)
      values (${this.tenantId}, ${values.number}, ${values.poId}, ${values.officeId},
              ${values.supplierId}, ${values.receivedDate}, ${values.deliveryNoteNo},
              ${values.supplierInvoiceNo}, ${values.shipmentType})
      returning id`;
    return row!.id;
  }

  /** draft → completed; the trigger refreshes po_line.accepted_qty. */
  async complete(id: string): Promise<void> {
    await this.sql`
      update public.grn set status = 'completed', completed_at = now()
      where tenant_id = ${this.tenantId} and id = ${id} and status = 'draft'`;
  }

  async cancel(id: string, expectedVersion: number, reason: string): Promise<void> {
    const rows = await this.sql`
      update public.grn
      set status = 'cancelled', cancelled_at = now(), cancel_reason = ${reason}
      where tenant_id = ${this.tenantId} and id = ${id} and version = ${expectedVersion}
      returning id`;
    if (rows.length === 0) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
  }

  /** Bumps the version (a signature that did not complete the GRN). */
  async touch(id: string, expectedVersion: number): Promise<void> {
    const rows = await this.sql`
      update public.grn set updated_at = now()
      where tenant_id = ${this.tenantId} and id = ${id} and version = ${expectedVersion}
      returning id`;
    if (rows.length === 0) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
  }

  async overDeliveryTolerancePct(): Promise<string> {
    const [row] = await this.sql<{ pct: string }[]>`
      select grn_over_delivery_tolerance_pct::text as pct from public.procurement_setting
      where tenant_id = ${this.tenantId}`;
    return row?.pct ?? '0';
  }
}
