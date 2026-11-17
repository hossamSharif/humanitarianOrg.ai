// purchase_order_version (data-model §5, research R23): insert-only snapshots of the header and
// lines. Version 1 is frozen when the PO is approved; each approved amendment adds the next.
import type { PoVersionView } from '@ngo/shared';
import type { TxSql } from '../db/tx';

type Json = Parameters<TxSql['json']>[0];

export class PoVersionRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  /** Snapshots the PO header and lines as they are now. */
  async snapshot(poId: string, version: number, amendmentId: string | null = null): Promise<void> {
    const sql = this.sql;
    await sql`
      insert into public.purchase_order_version
        (tenant_id, po_id, version, snapshot, created_by_amendment_id)
      select ${this.tenantId}, p.id, ${version},
             jsonb_build_object(
               'header', to_jsonb(p) - 'print_snapshot',
               'lines', coalesce((
                 select jsonb_agg(to_jsonb(l) order by l.line_no)
                 from public.po_line l where l.po_id = p.id
               ), '[]'::jsonb)
             ),
             ${amendmentId}
      from public.purchase_order p
      where p.tenant_id = ${this.tenantId} and p.id = ${poId}
      on conflict (po_id, version) do nothing`;
  }

  async insert(
    poId: string,
    version: number,
    snapshot: Record<string, unknown>,
    amendmentId: string | null
  ): Promise<void> {
    const sql = this.sql;
    await sql`
      insert into public.purchase_order_version
        (tenant_id, po_id, version, snapshot, created_by_amendment_id)
      values (${this.tenantId}, ${poId}, ${version}, ${sql.json(snapshot as Json)}, ${amendmentId})`;
  }

  async list(poId: string): Promise<Omit<PoVersionView, 'snapshot'>[]> {
    const rows = await this.sql<
      { version: number; created_at: Date; created_by_amendment_id: string | null }[]
    >`
      select version, created_at, created_by_amendment_id
      from public.purchase_order_version
      where tenant_id = ${this.tenantId} and po_id = ${poId}
      order by version`;
    return rows.map((r) => ({
      version: r.version,
      createdAt: r.created_at.toISOString(),
      createdByAmendmentId: r.created_by_amendment_id,
    }));
  }

  async get(poId: string, version: number): Promise<PoVersionView | null> {
    const [row] = await this.sql<
      {
        version: number;
        created_at: Date;
        created_by_amendment_id: string | null;
        snapshot: Record<string, unknown>;
      }[]
    >`
      select version, created_at, created_by_amendment_id, snapshot
      from public.purchase_order_version
      where tenant_id = ${this.tenantId} and po_id = ${poId} and version = ${version}`;
    return row
      ? {
          version: row.version,
          createdAt: row.created_at.toISOString(),
          createdByAmendmentId: row.created_by_amendment_id,
          snapshot: row.snapshot,
        }
      : null;
  }
}
