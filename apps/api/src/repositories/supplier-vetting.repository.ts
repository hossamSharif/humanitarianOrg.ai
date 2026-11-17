// supplier_vetting: insert-only checks against sanctions and debarment lists (FR-010). A clear
// result moves the supplier's last_vetted_at (trigger in migration 0015).
import type { SupplierVetting, SupplierVettingInput, VettingResult } from '@ngo/shared';
import type { TxSql } from '../db/tx';

interface Row {
  id: string;
  checked_on: string;
  checked_by: string;
  checked_by_name: string | null;
  lists_checked: string[];
  result: VettingResult;
  notes: string | null;
  created_at: Date;
}

const toVetting = (r: Row): SupplierVetting => ({
  id: r.id,
  checkedOn: r.checked_on,
  checkedBy: r.checked_by,
  checkedByName: r.checked_by_name ?? '',
  listsChecked: r.lists_checked,
  result: r.result,
  notes: r.notes,
  createdAt: r.created_at.toISOString(),
});

export class SupplierVettingRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async list(supplierId: string): Promise<SupplierVetting[]> {
    const rows = await this.sql<Row[]>`
      select v.id, v.checked_on::text, v.checked_by,
             coalesce(m.full_name_en, m.full_name_ar) as checked_by_name,
             v.lists_checked, v.result, v.notes, v.created_at
      from public.supplier_vetting v
      left join public.membership m on m.tenant_id = v.tenant_id and m.user_id = v.checked_by
      where v.tenant_id = ${this.tenantId} and v.supplier_id = ${supplierId}
      order by v.checked_on desc, v.created_at desc`;
    return rows.map(toVetting);
  }

  async insert(supplierId: string, input: SupplierVettingInput): Promise<string> {
    const sql = this.sql;
    const [row] = await sql<{ id: string }[]>`
      insert into public.supplier_vetting
        (tenant_id, supplier_id, checked_on, lists_checked, result, notes)
      values (${this.tenantId}, ${supplierId}, ${input.checkedOn},
              ${sql.array(input.listsChecked)}::text[], ${input.result}, ${input.notes ?? null})
      returning id`;
    return row!.id;
  }

  /** A clear vetting within the last `months` months (the re-vetting period, FR-010). */
  async hasCurrentClear(supplierId: string, months: number): Promise<boolean> {
    const [row] = await this.sql<{ id: string }[]>`
      select id from public.supplier_vetting
      where tenant_id = ${this.tenantId} and supplier_id = ${supplierId}
        and result = 'clear'
        and checked_on + make_interval(months => ${months}::int) >= current_date
      limit 1`;
    return row !== undefined;
  }
}
