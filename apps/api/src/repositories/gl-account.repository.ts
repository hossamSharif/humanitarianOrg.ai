// gl_account: the chart of accounts (002 data-model §6). A child takes its parent's type and the
// parent must be a group (trigger app.gl_account_hierarchy). An account that anything refers to
// is deactivated, not deleted (US12-1): `inUse` lists the references, and the FKs are restrict.
import type { GlAccountType, GlAccountView } from '@ngo/shared';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

interface Row {
  id: string;
  parent_id: string | null;
  code: string;
  name_ar: string;
  name_en: string;
  type: GlAccountType;
  is_posting: boolean;
  is_active: boolean;
  version: number;
  in_use: boolean;
}

const toView = (r: Row): GlAccountView => ({
  id: r.id,
  parentId: r.parent_id,
  code: r.code,
  nameAr: r.name_ar,
  nameEn: r.name_en,
  type: r.type,
  isPosting: r.is_posting,
  isActive: r.is_active,
  version: r.version,
  inUse: r.in_use,
});

export class GlAccountRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  /** Every table that refers to an account, for `inUse` and the delete check. */
  private inUse(alias: string) {
    const sql = this.sql;
    const id = sql.unsafe(`${alias}.id`);
    return sql`(
      exists (select 1 from public.gl_account c where c.parent_id = ${id})
      or exists (select 1 from public.budget_category_account x where x.expense_account_id = ${id})
      or exists (select 1 from public.budget_line x where x.expense_account_id = ${id})
      or exists (select 1 from public.money_account x where x.gl_account_id = ${id})
      or exists (select 1 from public.control_account_setting x where x.account_id = ${id})
      or exists (select 1 from public.deduction_type x where x.payable_account_id = ${id})
      or exists (select 1 from public.payment_request_deduction x where x.payable_account_id = ${id})
    )`;
  }

  async list(filter: {
    type?: GlAccountType;
    postingOnly?: boolean;
    includeInactive?: boolean;
  }): Promise<GlAccountView[]> {
    const sql = this.sql;
    const rows = await sql<Row[]>`
      select g.id, g.parent_id, g.code, g.name_ar, g.name_en, g.type, g.is_posting, g.is_active,
             g.version, ${this.inUse('g')} as in_use
      from public.gl_account g
      where g.tenant_id = ${this.tenantId}
        ${filter.type ? sql`and g.type = ${filter.type}` : sql``}
        ${filter.postingOnly ? sql`and g.is_posting` : sql``}
        ${filter.includeInactive === false ? sql`and g.is_active` : sql``}
      order by g.code`;
    return rows.map(toView);
  }

  async find(id: string): Promise<GlAccountView | null> {
    const [row] = await this.sql<Row[]>`
      select g.id, g.parent_id, g.code, g.name_ar, g.name_en, g.type, g.is_posting, g.is_active,
             g.version, ${this.inUse('g')} as in_use
      from public.gl_account g
      where g.tenant_id = ${this.tenantId} and g.id = ${id}`;
    return row ? toView(row) : null;
  }

  async get(id: string): Promise<GlAccountView> {
    const account = await this.find(id);
    if (!account) throw new AppError('NOT_FOUND', 'Account not found');
    return account;
  }

  async insert(values: {
    parentId: string | null;
    code: string;
    nameAr: string;
    nameEn: string;
    type: GlAccountType;
    isPosting: boolean;
  }): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.gl_account (tenant_id, parent_id, code, name_ar, name_en, type, is_posting)
      values (${this.tenantId}, ${values.parentId}, ${values.code}, ${values.nameAr},
              ${values.nameEn}, ${values.type}, ${values.isPosting})
      returning id`;
    return row!.id;
  }

  async update(
    id: string,
    expectedVersion: number,
    changes: { name_ar?: string; name_en?: string; is_posting?: boolean; is_active?: boolean }
  ): Promise<void> {
    const sql = this.sql;
    const rows = await sql`
      update public.gl_account
      set ${Object.keys(changes).length ? sql(changes) : sql`updated_at = now()`}
      where tenant_id = ${this.tenantId} and id = ${id} and version = ${expectedVersion}
      returning id`;
    if (rows.length === 0) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
  }

  async delete(id: string): Promise<void> {
    await this.sql`delete from public.gl_account where tenant_id = ${this.tenantId} and id = ${id}`;
  }

  async codeExists(code: string): Promise<boolean> {
    const [row] = await this.sql<{ exists: boolean }[]>`
      select exists (
        select 1 from public.gl_account where tenant_id = ${this.tenantId} and code = ${code}
      ) as exists`;
    return row!.exists;
  }
}
