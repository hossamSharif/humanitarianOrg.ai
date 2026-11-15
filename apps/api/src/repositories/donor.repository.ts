import type { Donor, ListResponse, Pagination, Sort } from '@ngo/shared';
import { AppError } from '../middleware/error';
import type { RequestContext } from '../types/context';
import { TableAccess, escapeLike, unwrap, unwrapList } from './query-helpers';

export interface DonorFilter {
  isActive?: boolean;
}

export type DonorValues = Omit<Donor, 'id'>;

/** Port used by GrantService; implemented over supabase-js below and in memory for unit tests. */
export interface DonorStore {
  list(filter: DonorFilter, pagination: Pagination, sort?: Sort): Promise<ListResponse<Donor>>;
  findById(id: string): Promise<Donor | null>;
  /** case-insensitive, matches the unique index on lower(name) */
  findByName(name: string): Promise<Donor | null>;
  insert(values: DonorValues): Promise<Donor>;
  update(id: string, values: Partial<DonorValues>): Promise<Donor>;
}

const COLUMNS = 'id,name,short_name,contact_name,contact_email,contact_phone,notes,is_active';

interface DonorRow {
  id: string;
  name: string;
  short_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  is_active: boolean;
}

function toDonor(r: DonorRow): Donor {
  return {
    id: r.id,
    name: r.name,
    shortName: r.short_name,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    notes: r.notes,
    isActive: r.is_active,
  };
}

function toRow(values: Partial<DonorValues>): Record<string, unknown> {
  const row: Record<string, unknown> = {
    name: values.name,
    short_name: values.shortName,
    contact_name: values.contactName,
    contact_email: values.contactEmail,
    contact_phone: values.contactPhone,
    notes: values.notes,
    is_active: values.isActive,
  };
  for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
  return row;
}

export class DonorRepository implements DonorStore {
  private readonly t: TableAccess;

  constructor(private readonly ctx: RequestContext) {
    this.t = new TableAccess(ctx, 'donor');
  }

  async list(filter: DonorFilter, pagination: Pagination, sort?: Sort) {
    return this.t.page<Donor>({
      pagination,
      sort,
      sortable: ['name', 'shortName', 'createdAt'],
      defaultSort: { field: 'name', direction: 'asc' },
      filters: { isActive: filter.isActive },
      select: COLUMNS,
    });
  }

  async findById(id: string): Promise<Donor | null> {
    const data = unwrap<DonorRow>(await this.t.from().select(COLUMNS).eq('id', id).maybeSingle());
    return data ? toDonor(data) : null;
  }

  async findByName(name: string): Promise<Donor | null> {
    const rows = unwrapList<DonorRow>(
      await this.t.from().select(COLUMNS).ilike('name', escapeLike(name.trim())).limit(1)
    );
    return rows[0] ? toDonor(rows[0]) : null;
  }

  async insert(values: DonorValues): Promise<Donor> {
    const data = unwrap<DonorRow>(
      await this.t
        .from()
        .insert({ ...toRow(values), tenant_id: this.ctx.tenantId })
        .select(COLUMNS)
        .single()
    );
    return toDonor(data!);
  }

  async update(id: string, values: Partial<DonorValues>): Promise<Donor> {
    const data = unwrap<DonorRow>(
      await this.t.from().update(toRow(values)).eq('id', id).select(COLUMNS).maybeSingle()
    );
    if (!data) throw new AppError('NOT_FOUND', 'donor not found');
    return toDonor(data);
  }
}
