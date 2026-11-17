// staff_payee: staff paid by direct payment or advance, with bank details (002 data-model §3).
// Runs inside withTenantTx; deactivated, never deleted.
import type { ListResponse, Pagination, StaffPayee } from '@ngo/shared';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';
import { escapeLike } from './query-helpers';

interface Row {
  id: string;
  membership_id: string | null;
  full_name_ar: string;
  full_name_en: string;
  phone: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account_name: string | null;
  bank_account_no: string | null;
  is_active: boolean;
  version: number;
  total?: number;
}

const toPayee = (r: Row): StaffPayee => ({
  id: r.id,
  membershipId: r.membership_id,
  fullNameAr: r.full_name_ar,
  fullNameEn: r.full_name_en,
  phone: r.phone,
  bankName: r.bank_name,
  bankBranch: r.bank_branch,
  bankAccountName: r.bank_account_name,
  bankAccountNo: r.bank_account_no,
  isActive: r.is_active,
  version: r.version,
});

export interface StaffPayeeValues {
  membershipId?: string | null;
  fullNameAr?: string;
  fullNameEn?: string;
  phone?: string | null;
  bankName?: string | null;
  bankBranch?: string | null;
  bankAccountName?: string | null;
  bankAccountNo?: string | null;
  isActive?: boolean;
}

const COLUMNS: Record<keyof StaffPayeeValues, string> = {
  membershipId: 'membership_id',
  fullNameAr: 'full_name_ar',
  fullNameEn: 'full_name_en',
  phone: 'phone',
  bankName: 'bank_name',
  bankBranch: 'bank_branch',
  bankAccountName: 'bank_account_name',
  bankAccountNo: 'bank_account_no',
  isActive: 'is_active',
};

export class StaffPayeeRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  private columns(values: StaffPayeeValues): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(COLUMNS)) {
      const value = values[key as keyof StaffPayeeValues];
      if (value !== undefined) out[column] = value;
    }
    return out;
  }

  async list(filter: {
    pagination: Pagination;
    q?: string;
    active?: boolean;
  }): Promise<ListResponse<StaffPayee>> {
    const sql = this.sql;
    const { page, pageSize } = filter.pagination;
    const like = filter.q ? `%${escapeLike(filter.q)}%` : null;
    const rows = await sql<Row[]>`
      select id, membership_id, full_name_ar, full_name_en, phone, bank_name, bank_branch,
             bank_account_name, bank_account_no, is_active, version,
             count(*) over ()::int as total
      from public.staff_payee
      where tenant_id = ${this.tenantId}
        ${filter.active === undefined ? sql`` : sql`and is_active = ${filter.active}`}
        ${like ? sql`and (full_name_ar ilike ${like} or full_name_en ilike ${like})` : sql``}
      order by full_name_en, id
      limit ${pageSize} offset ${(page - 1) * pageSize}`;
    return { data: rows.map(toPayee), page, pageSize, total: rows[0]?.total ?? 0 };
  }

  async getById(id: string): Promise<StaffPayee> {
    const [row] = await this.sql<Row[]>`
      select id, membership_id, full_name_ar, full_name_en, phone, bank_name, bank_branch,
             bank_account_name, bank_account_no, is_active, version
      from public.staff_payee where tenant_id = ${this.tenantId} and id = ${id}`;
    if (!row) throw new AppError('NOT_FOUND', 'Staff payee not found');
    return toPayee(row);
  }

  async membershipExists(membershipId: string): Promise<boolean> {
    const [row] = await this.sql<{ id: string }[]>`
      select id from public.membership where tenant_id = ${this.tenantId} and id = ${membershipId}`;
    return row !== undefined;
  }

  async insert(values: StaffPayeeValues): Promise<string> {
    const sql = this.sql;
    const [row] = await sql<{ id: string }[]>`
      insert into public.staff_payee ${sql({ tenant_id: this.tenantId, ...this.columns(values) })}
      returning id`;
    return row!.id;
  }

  /** 409 VERSION_CONFLICT when `expectedVersion` is stale. */
  async update(id: string, values: StaffPayeeValues, expectedVersion: number): Promise<void> {
    const sql = this.sql;
    const changes = this.columns(values);
    const rows = await sql`
      update public.staff_payee
      set ${Object.keys(changes).length ? sql(changes) : sql`updated_at = now()`}
      where tenant_id = ${this.tenantId} and id = ${id} and version = ${expectedVersion}
      returning id`;
    if (rows.length === 0) {
      await this.getById(id);
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
  }
}
