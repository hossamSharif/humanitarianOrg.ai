// supplier with its categories, compliance (view supplier_compliance) and duplicate lookups
// (public.party_duplicates), 002 data-model §3. Runs inside withTenantTx.
import type {
  DuplicateWarning,
  ListResponse,
  Pagination,
  Sort,
  SupplierCompliance,
  SupplierStatus,
  SupplierSummary,
  SupplierType,
} from '@ngo/shared';
import type postgres from 'postgres';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';
import { escapeLike } from './query-helpers';

export interface SupplierRecord extends SupplierSummary {
  registrationNo: string | null;
  taxNo: string | null;
  address: string | null;
  city: string | null;
  email: string | null;
  contactPerson: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccountName: string | null;
  bankAccountNo: string | null;
  notes: string | null;
  statusReason: string | null;
  ratingAvgOnTime: string | null;
  ratingAvgQuality: string | null;
  ratingAvgDocs: string | null;
  ratingCount: number;
  version: number;
}

/** Writable supplier columns (camelCase); categories are written separately. */
export interface SupplierValues {
  legalNameAr?: string;
  legalNameEn?: string;
  tradeName?: string | null;
  type?: SupplierType;
  registrationNo?: string | null;
  taxNo?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  contactPerson?: string | null;
  bankName?: string | null;
  bankBranch?: string | null;
  bankAccountName?: string | null;
  bankAccountNo?: string | null;
  notes?: string | null;
}

const COLUMNS: Record<keyof SupplierValues, string> = {
  legalNameAr: 'legal_name_ar',
  legalNameEn: 'legal_name_en',
  tradeName: 'trade_name',
  type: 'type',
  registrationNo: 'registration_no',
  taxNo: 'tax_no',
  address: 'address',
  city: 'city',
  phone: 'phone',
  email: 'email',
  contactPerson: 'contact_person',
  bankName: 'bank_name',
  bankBranch: 'bank_branch',
  bankAccountName: 'bank_account_name',
  bankAccountNo: 'bank_account_no',
  notes: 'notes',
};

type Fragment = postgres.PendingQuery<postgres.Row[]>;

const SORTABLE: Record<string, string> = {
  legalNameEn: 's.legal_name_en',
  legalNameAr: 's.legal_name_ar',
  status: 's.status',
  lastVettedAt: 's.last_vetted_at',
  createdAt: 's.created_at',
};

interface Row {
  id: string;
  legal_name_ar: string;
  legal_name_en: string;
  trade_name: string | null;
  type: SupplierType;
  status: SupplierStatus;
  status_reason: string | null;
  registration_no: string | null;
  tax_no: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  contact_person: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account_name: string | null;
  bank_account_no: string | null;
  notes: string | null;
  last_vetted_at: string | null;
  rating_avg_on_time: string | null;
  rating_avg_quality: string | null;
  rating_avg_docs: string | null;
  rating_count: number;
  version: number;
  vetting_overdue: boolean;
  has_expired_required_doc: boolean;
  can_invite: boolean;
  can_award_or_pay: boolean;
  category_ids: string[];
  total?: number;
}

function compliance(r: Row): SupplierCompliance {
  return {
    vettingOverdue: r.vetting_overdue,
    hasExpiredRequiredDoc: r.has_expired_required_doc,
    canInvite: r.can_invite,
    canAwardOrPay: r.can_award_or_pay,
  };
}

function toRecord(r: Row): SupplierRecord {
  return {
    id: r.id,
    legalNameAr: r.legal_name_ar,
    legalNameEn: r.legal_name_en,
    tradeName: r.trade_name,
    type: r.type,
    status: r.status,
    phone: r.phone,
    lastVettedAt: r.last_vetted_at,
    compliance: compliance(r),
    categoryIds: r.category_ids,
    registrationNo: r.registration_no,
    taxNo: r.tax_no,
    address: r.address,
    city: r.city,
    email: r.email,
    contactPerson: r.contact_person,
    bankName: r.bank_name,
    bankBranch: r.bank_branch,
    bankAccountName: r.bank_account_name,
    bankAccountNo: r.bank_account_no,
    notes: r.notes,
    statusReason: r.status_reason,
    ratingAvgOnTime: r.rating_avg_on_time,
    ratingAvgQuality: r.rating_avg_quality,
    ratingAvgDocs: r.rating_avg_docs,
    ratingCount: r.rating_count,
    version: r.version,
  };
}

const toSummary = (r: Row): SupplierSummary => {
  const { id, legalNameAr, legalNameEn, tradeName, type, status, phone, lastVettedAt } =
    toRecord(r);
  return {
    id,
    legalNameAr,
    legalNameEn,
    tradeName,
    type,
    status,
    phone,
    lastVettedAt,
    compliance: compliance(r),
    categoryIds: r.category_ids,
  };
};

export interface SupplierListFilter {
  pagination: Pagination;
  sort?: Sort;
  status?: SupplierStatus;
  categoryId?: string;
  q?: string;
  compliance?: 'eligible' | 'flagged';
}

interface DuplicateRow {
  party_kind: 'supplier' | 'staff_payee';
  party_id: string;
  name_ar: string;
  name_en: string;
  field: DuplicateWarning['field'];
}

const toDuplicate = (r: DuplicateRow): DuplicateWarning => ({
  partyKind: r.party_kind,
  partyId: r.party_id,
  nameAr: r.name_ar,
  nameEn: r.name_en,
  field: r.field,
});

export interface PartyIdentifiers {
  registrationNo?: string | null;
  taxNo?: string | null;
  phone?: string | null;
  bankAccountNo?: string | null;
}

/** Matches of normalized identifiers across suppliers and staff payees (warning only). */
export async function partyDuplicates(
  sql: TxSql,
  ids: PartyIdentifiers,
  excludeId: string | null
): Promise<DuplicateWarning[]> {
  const rows = await sql<DuplicateRow[]>`
    select party_kind, party_id, name_ar, name_en, field
    from public.party_duplicates(
      ${ids.registrationNo ?? null}, ${ids.taxNo ?? null}, ${ids.phone ?? null},
      ${ids.bankAccountNo ?? null}, ${excludeId}::uuid)
    order by name_en, field`;
  return rows.map(toDuplicate);
}

export class SupplierRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  private select(where: Fragment, tail: Fragment = this.sql``) {
    return this.sql<Row[]>`
      select s.id, s.legal_name_ar, s.legal_name_en, s.trade_name, s.type, s.status,
             s.status_reason, s.registration_no, s.tax_no, s.address, s.city, s.phone, s.email,
             s.contact_person, s.bank_name, s.bank_branch, s.bank_account_name,
             s.bank_account_no, s.notes, s.last_vetted_at::text,
             s.rating_avg_on_time::text, s.rating_avg_quality::text, s.rating_avg_docs::text,
             s.rating_count, s.version,
             c.vetting_overdue, c.has_expired_required_doc, c.can_invite, c.can_award_or_pay,
             coalesce((select jsonb_agg(l.category_id) from public.supplier_category_link l
                       where l.supplier_id = s.id), '[]'::jsonb) as category_ids,
             count(*) over ()::int as total
      from public.supplier s
      join public.supplier_compliance c on c.supplier_id = s.id
      where s.tenant_id = ${this.tenantId} ${where}
      ${tail}`;
  }

  async list(filter: SupplierListFilter): Promise<ListResponse<SupplierSummary>> {
    const sql = this.sql;
    const { page, pageSize } = filter.pagination;
    const sort = filter.sort ?? { field: 'legalNameEn', direction: 'asc' as const };
    const column = SORTABLE[sort.field];
    if (!column) {
      throw new AppError('VALIDATION_ERROR', `Cannot sort by ${sort.field}`, [
        { field: 'query.sort', message: 'unsupported_field' },
      ]);
    }
    const like = filter.q ? `%${escapeLike(filter.q)}%` : null;
    const rows = await this.select(
      sql`
        ${filter.status ? sql`and s.status = ${filter.status}` : sql``}
        ${
          filter.categoryId
            ? sql`and exists (select 1 from public.supplier_category_link l
                              where l.supplier_id = s.id and l.category_id = ${filter.categoryId})`
            : sql``
        }
        ${
          like
            ? sql`and (s.legal_name_ar ilike ${like} or s.legal_name_en ilike ${like}
                       or s.trade_name ilike ${like} or s.registration_no ilike ${like})`
            : sql``
        }
        ${filter.compliance === 'eligible' ? sql`and c.can_award_or_pay` : sql``}
        ${
          filter.compliance === 'flagged'
            ? sql`and s.status <> 'blacklisted' and not c.can_award_or_pay`
            : sql``
        }`,
      sql`order by ${sql.unsafe(column)} ${sql.unsafe(sort.direction)} nulls last, s.id
          limit ${pageSize} offset ${(page - 1) * pageSize}`
    );
    return { data: rows.map(toSummary), page, pageSize, total: rows[0]?.total ?? 0 };
  }

  async findById(id: string): Promise<SupplierRecord | null> {
    const [row] = await this.select(this.sql`and s.id = ${id}`);
    return row ? toRecord(row) : null;
  }

  async getById(id: string): Promise<SupplierRecord> {
    const supplier = await this.findById(id);
    if (!supplier) throw new AppError('NOT_FOUND', 'Supplier not found');
    return supplier;
  }

  /** Locks the supplier row for a status change or edit. */
  async lock(id: string): Promise<{ status: SupplierStatus; version: number }> {
    const [row] = await this.sql<{ status: SupplierStatus; version: number }[]>`
      select status, version from public.supplier
      where tenant_id = ${this.tenantId} and id = ${id}
      for update`;
    if (!row) throw new AppError('NOT_FOUND', 'Supplier not found');
    return row;
  }

  private columns(values: SupplierValues): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(COLUMNS)) {
      const value = values[key as keyof SupplierValues];
      if (value !== undefined) out[column] = value;
    }
    return out;
  }

  async insert(values: SupplierValues): Promise<string> {
    const sql = this.sql;
    const [row] = await sql<{ id: string }[]>`
      insert into public.supplier ${sql({ tenant_id: this.tenantId, ...this.columns(values) })}
      returning id`;
    return row!.id;
  }

  /** 409 VERSION_CONFLICT when `expectedVersion` is stale. */
  async update(id: string, values: SupplierValues, expectedVersion: number): Promise<void> {
    const sql = this.sql;
    const changes = this.columns(values);
    // a version bump even without column changes (categories only), so editors see the change
    const rows = await sql`
      update public.supplier
      set ${Object.keys(changes).length ? sql(changes) : sql`updated_at = now()`}
      where tenant_id = ${this.tenantId} and id = ${id} and version = ${expectedVersion}
      returning id`;
    if (rows.length === 0) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
  }

  async setStatus(
    id: string,
    status: SupplierStatus,
    reason: string | null,
    expectedVersion: number
  ): Promise<void> {
    const rows = await this.sql`
      update public.supplier set status = ${status}, status_reason = ${reason}
      where tenant_id = ${this.tenantId} and id = ${id} and version = ${expectedVersion}
      returning id`;
    if (rows.length === 0) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
  }

  async setCategories(id: string, categoryIds: readonly string[]): Promise<void> {
    const sql = this.sql;
    await sql`
      delete from public.supplier_category_link
      where tenant_id = ${this.tenantId} and supplier_id = ${id}
        and not (category_id = any (${sql.array([...categoryIds])}::uuid[]))`;
    if (categoryIds.length === 0) return;
    await sql`
      insert into public.supplier_category_link ${sql(
        categoryIds.map((categoryId) => ({
          tenant_id: this.tenantId,
          supplier_id: id,
          category_id: categoryId,
        }))
      )}
      on conflict (supplier_id, category_id) do nothing`;
  }

  /** Ids among `ids` that are categories of the tenant. */
  async existingCategoryIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const sql = this.sql;
    const rows = await sql<{ id: string }[]>`
      select id from public.supplier_category
      where tenant_id = ${this.tenantId} and id = any (${sql.array([...ids])}::uuid[])`;
    return new Set(rows.map((r) => r.id));
  }

  async duplicates(id: string): Promise<DuplicateWarning[]> {
    const rows = await this.sql<DuplicateRow[]>`
      select party_kind, party_id, name_ar, name_en, field
      from public.supplier_duplicates(${id})
      order by name_en, field`;
    return rows.map(toDuplicate);
  }
}
