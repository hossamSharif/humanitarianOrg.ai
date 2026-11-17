// supplier_invoice / supplier_invoice_line (002 data-model §7, research R25): numbered INV on
// registration; supplier and office are re-copied from the PO by trigger
// (app.supplier_invoice_inherit) and never written here; the amount is Σ lines (trigger).
import type {
  InvoiceLineInput,
  ListResponse,
  SupplierInvoiceLineView,
  SupplierInvoiceStatus,
  SupplierInvoiceSummary,
} from '@ngo/shared';
import type postgres from 'postgres';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

type Json = Parameters<TxSql['json']>[0];

export interface SupplierInvoiceRecord extends SupplierInvoiceSummary {
  version: number;
  officeId: string;
  attachmentId: string | null;
  createdBy: string;
}

interface Row {
  id: string;
  number: string;
  status: SupplierInvoiceStatus;
  po_id: string;
  po_number: string | null;
  supplier_id: string;
  supplier_name_ar: string;
  supplier_name_en: string;
  supplier_invoice_no: string;
  invoice_date: string;
  currency: string;
  amount: string;
  created_at: Date;
  version: number;
  office_id: string;
  attachment_id: string | null;
  created_by: string;
  total_count?: number;
}

const toRecord = (r: Row): SupplierInvoiceRecord => ({
  id: r.id,
  number: r.number,
  status: r.status,
  poId: r.po_id,
  poNumber: r.po_number,
  supplierId: r.supplier_id,
  supplierNameAr: r.supplier_name_ar,
  supplierNameEn: r.supplier_name_en,
  supplierInvoiceNo: r.supplier_invoice_no,
  invoiceDate: r.invoice_date,
  currency: r.currency,
  amount: r.amount,
  createdAt: r.created_at.toISOString(),
  version: r.version,
  officeId: r.office_id,
  attachmentId: r.attachment_id,
  createdBy: r.created_by,
});

export interface NewSupplierInvoice {
  number: string;
  poId: string;
  officeId: string;
  supplierId: string;
  supplierInvoiceNo: string;
  invoiceDate: string;
  currency: string;
  attachmentId: string | null;
}

export class SupplierInvoiceRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  private select(where: postgres.PendingQuery<postgres.Row[]>, tail = this.sql``) {
    return this.sql<Row[]>`
      select i.id, i.number, i.status, i.po_id, p.number as po_number, i.supplier_id,
             s.legal_name_ar as supplier_name_ar, s.legal_name_en as supplier_name_en,
             i.supplier_invoice_no, i.invoice_date::text, i.currency::text, i.amount::text,
             i.created_at, i.version, i.office_id, i.attachment_id, i.created_by,
             count(*) over ()::int as total_count
      from public.supplier_invoice i
      join public.purchase_order p on p.id = i.po_id
      join public.supplier s on s.id = i.supplier_id
      where i.tenant_id = ${this.tenantId} ${where}
      ${tail}`;
  }

  async list(filter: {
    page: number;
    pageSize: number;
    status?: SupplierInvoiceStatus;
    poId?: string;
  }): Promise<ListResponse<SupplierInvoiceSummary>> {
    const sql = this.sql;
    const { page, pageSize } = filter;
    const rows = await this.select(
      sql`${filter.status ? sql`and i.status = ${filter.status}` : sql``}
          ${filter.poId ? sql`and i.po_id = ${filter.poId}` : sql``}`,
      sql`order by i.created_at desc, i.id limit ${pageSize} offset ${(page - 1) * pageSize}`
    );
    return { data: rows.map(toRecord), page, pageSize, total: rows[0]?.total_count ?? 0 };
  }

  async find(id: string, options: { lock?: boolean } = {}): Promise<SupplierInvoiceRecord | null> {
    if (options.lock) {
      const [locked] = await this.sql<{ id: string }[]>`
        select id from public.supplier_invoice
        where tenant_id = ${this.tenantId} and id = ${id} for update`;
      if (!locked) return null;
    }
    const [row] = await this.select(this.sql`and i.id = ${id}`);
    return row ? toRecord(row) : null;
  }

  async get(id: string, options: { lock?: boolean } = {}): Promise<SupplierInvoiceRecord> {
    const invoice = await this.find(id, options);
    if (!invoice) throw new AppError('NOT_FOUND', 'Invoice not found');
    return invoice;
  }

  /** A live invoice of the supplier with the same number, ignoring case and spaces (US11-5). */
  async findDuplicate(supplierId: string, supplierInvoiceNo: string): Promise<string | null> {
    const [row] = await this.sql<{ number: string }[]>`
      select number from public.supplier_invoice
      where tenant_id = ${this.tenantId} and supplier_id = ${supplierId}
        and lower(btrim(supplier_invoice_no)) = lower(btrim(${supplierInvoiceNo}))
        and status <> 'cancelled'`;
    return row?.number ?? null;
  }

  async insert(values: NewSupplierInvoice): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.supplier_invoice
        (tenant_id, number, po_id, office_id, supplier_id, supplier_invoice_no, invoice_date,
         currency, attachment_id)
      values (${this.tenantId}, ${values.number}, ${values.poId}, ${values.officeId},
              ${values.supplierId}, ${values.supplierInvoiceNo.trim()}, ${values.invoiceDate},
              ${values.currency}, ${values.attachmentId})
      returning id`;
    return row!.id;
  }

  async insertLines(invoiceId: string, lines: readonly InvoiceLineInput[]): Promise<void> {
    const sql = this.sql;
    await sql`
      insert into public.supplier_invoice_line (tenant_id, invoice_id, po_line_id, quantity, unit_price)
      select ${this.tenantId}, ${invoiceId}, x."poLineId", x.quantity, x."unitPrice"
      from jsonb_to_recordset(${sql.json(lines as unknown as Json)}) as x (
        "poLineId" uuid, quantity numeric, "unitPrice" numeric
      )`;
  }

  async lines(invoiceId: string): Promise<SupplierInvoiceLineView[]> {
    const rows = await this.sql<
      {
        id: string;
        po_line_id: string;
        line_no: number;
        description: string | null;
        quantity: string;
        unit_price: string;
        line_total: string;
        ordered_qty: string;
        po_price: string;
        accepted_qty: string;
      }[]
    >`
      select x.id, x.po_line_id, o.line_no, o.description, x.quantity::text, x.unit_price::text,
             x.line_total::text, o.quantity::text as ordered_qty, o.unit_price::text as po_price,
             o.accepted_qty::text
      from public.supplier_invoice_line x
      join public.po_line o on o.id = x.po_line_id
      where x.tenant_id = ${this.tenantId} and x.invoice_id = ${invoiceId}
      order by o.line_no`;
    return rows.map((r) => ({
      id: r.id,
      poLineId: r.po_line_id,
      lineNo: r.line_no,
      description: r.description,
      quantity: r.quantity,
      unitPrice: r.unit_price,
      lineTotal: r.line_total,
      orderedQty: r.ordered_qty,
      poPrice: r.po_price,
      acceptedQty: r.accepted_qty,
    }));
  }

  async setStatus(id: string, status: SupplierInvoiceStatus): Promise<void> {
    await this.sql`
      update public.supplier_invoice set status = ${status}
      where tenant_id = ${this.tenantId} and id = ${id} and status <> 'cancelled'`;
  }
}
