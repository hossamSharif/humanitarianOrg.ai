// supplier_document: registration, tax and other documents with expiry (002 data-model §3).
// A required document past its expiry makes the supplier non-compliant (supplier_compliance).
import type { SupplierDocKind, SupplierDocument, SupplierDocumentInput } from '@ngo/shared';
import type { TxSql } from '../db/tx';

interface Row {
  id: string;
  doc_kind: SupplierDocKind;
  is_required: boolean;
  number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  expired: boolean;
}

const toDocument = (r: Row): SupplierDocument => ({
  id: r.id,
  docKind: r.doc_kind,
  isRequired: r.is_required,
  number: r.number,
  issueDate: r.issue_date,
  expiryDate: r.expiry_date,
  expired: r.expired,
});

export class SupplierDocumentRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async list(supplierId: string): Promise<SupplierDocument[]> {
    const rows = await this.sql<Row[]>`
      select id, doc_kind, is_required, number, issue_date::text, expiry_date::text,
             coalesce(expiry_date < current_date, false) as expired
      from public.supplier_document
      where tenant_id = ${this.tenantId} and supplier_id = ${supplierId}
      order by is_required desc, expiry_date nulls last, created_at`;
    return rows.map(toDocument);
  }

  async insert(supplierId: string, input: SupplierDocumentInput): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.supplier_document
        (tenant_id, supplier_id, doc_kind, is_required, number, issue_date, expiry_date)
      values (${this.tenantId}, ${supplierId}, ${input.docKind}, ${input.isRequired},
              ${input.number ?? null}, ${input.issueDate ?? null}, ${input.expiryDate ?? null})
      returning id`;
    return row!.id;
  }
}
