// supplier_category: the tenant's supplier categories (002 data-model §3). The payment category
// repository extends this one with `procurement_only`. Runs inside withTenantTx; categories are
// deactivated, never deleted.
import type { SupplierCategory } from '@ngo/shared';
import type postgres from 'postgres';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

export interface CategoryRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  is_active: boolean;
  version: number;
  procurement_only?: boolean;
}

export interface CategoryValues {
  code?: string;
  nameAr?: string;
  nameEn?: string;
  isActive?: boolean;
  procurementOnly?: boolean;
}

/** Shared CRUD of the two category tables; `extraColumns` adds a table's own columns. */
export abstract class CategoryRepository<T extends SupplierCategory> {
  protected abstract readonly table: 'supplier_category' | 'payment_category';
  protected abstract readonly label: string;
  protected abstract toItem(row: CategoryRow): T;
  protected abstract extraColumns(): postgres.PendingQuery<postgres.Row[]>;

  constructor(
    protected readonly sql: TxSql,
    protected readonly tenantId: string
  ) {}

  private select(id?: string) {
    const sql = this.sql;
    return sql<CategoryRow[]>`
      select id, code, name_ar, name_en, is_active, version ${this.extraColumns()}
      from ${sql('public.' + this.table)}
      where tenant_id = ${this.tenantId} ${id ? sql`and id = ${id}` : sql``}
      order by code`;
  }

  async list(): Promise<T[]> {
    return (await this.select()).map((r) => this.toItem(r));
  }

  async getById(id: string): Promise<T> {
    const [row] = await this.select(id);
    if (!row) throw new AppError('NOT_FOUND', `${this.label} not found`);
    return this.toItem(row);
  }

  async findByCode(code: string): Promise<T | null> {
    const [row] = await this.sql<{ id: string }[]>`
      select id from ${this.sql('public.' + this.table)}
      where tenant_id = ${this.tenantId} and code = ${code}`;
    return row ? this.getById(row.id) : null;
  }

  protected row(values: CategoryValues): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (values.code !== undefined) out.code = values.code;
    if (values.nameAr !== undefined) out.name_ar = values.nameAr;
    if (values.nameEn !== undefined) out.name_en = values.nameEn;
    if (values.isActive !== undefined) out.is_active = values.isActive;
    return out;
  }

  async insert(values: CategoryValues): Promise<string> {
    const sql = this.sql;
    const [row] = await sql<{ id: string }[]>`
      insert into ${sql('public.' + this.table)}
        ${sql({ tenant_id: this.tenantId, ...this.row(values) })}
      returning id`;
    return row!.id;
  }

  /** 409 VERSION_CONFLICT when `expectedVersion` is stale. */
  async update(id: string, values: CategoryValues, expectedVersion: number): Promise<void> {
    const sql = this.sql;
    const changes = this.row(values);
    const current = await this.getById(id);
    if (current.version !== expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
    if (Object.keys(changes).length === 0) return;
    const rows = await sql`
      update ${sql('public.' + this.table)} set ${sql(changes)}
      where tenant_id = ${this.tenantId} and id = ${id} and version = ${expectedVersion}
      returning id`;
    if (rows.length === 0) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
  }
}

export class SupplierCategoryRepository extends CategoryRepository<SupplierCategory> {
  protected readonly table = 'supplier_category' as const;
  protected readonly label = 'Supplier category';

  protected extraColumns() {
    return this.sql``;
  }

  protected toItem(r: CategoryRow): SupplierCategory {
    return {
      id: r.id,
      code: r.code,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      isActive: r.is_active,
      version: r.version,
    };
  }
}
