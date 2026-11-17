// app.doc_type_registry lookups (002 data-model §1): the parent table of a document type and
// a document's header fields, read under the caller's RLS so an unreadable document is "not
// found". Table and column names come from the registry (migration-controlled), never from input.
import type { DocTypeCode } from '@ngo/shared';
import type { TxSql } from '../db/tx';

export interface DocHeader {
  id: string;
  status: string;
  number: string | null;
  officeId: string | null;
}

export interface DocRegistryStore {
  header(docType: DocTypeCode, docId: string): Promise<DocHeader | null>;
}

interface RegistryRow {
  table_name: string | null;
  office_column: string | null;
}

const PR_TABLE: RegistryRow = {
  table_name: 'public.purchase_requisition',
  office_column: 'requesting_office_id',
};

export class DocRegistryRepository implements DocRegistryStore {
  constructor(private readonly sql: TxSql) {}

  private async parent(docType: DocTypeCode): Promise<RegistryRow | null> {
    if (docType === 'PR') return PR_TABLE;
    const [row] = await this.sql<RegistryRow[]>`
      select table_name::text as table_name, office_column
      from app.doc_type_registry where code = ${docType}`;
    return row && row.table_name ? row : null;
  }

  async header(docType: DocTypeCode, docId: string): Promise<DocHeader | null> {
    const parent = await this.parent(docType);
    if (!parent?.table_name || !parent.office_column) return null;
    const office = parent.office_column.replace(/"/g, '');
    const [row] = await this.sql.unsafe<
      { id: string; status: string; number: string | null; office_id: string | null }[]
    >(
      `select t.id, t.status, t.number, t."${office}" as office_id
       from ${parent.table_name} t where t.id = $1`,
      [docId]
    );
    return row
      ? { id: row.id, status: row.status, number: row.number, officeId: row.office_id }
      : null;
  }
}
