// Offices / locations of the caller's tenant (RLS-scoped).
import type { Tables } from '@ngo/database';
import type { ListResponse, Pagination, Sort } from '@ngo/shared';
import type { UserClient } from '../db/supabase';
import { withTenantTx } from '../db/tx';
import type { RequestContext } from '../types/context';
import { BaseRepository, type Camelized } from './base.repository';

export type OfficeRow = Camelized<Tables<'office'>>;

export interface ActiveListFilter {
  pagination: Pagination;
  sort?: Sort;
  isActive?: boolean;
}

export interface OfficeStore {
  listOffices(filter: ActiveListFilter): Promise<ListResponse<OfficeRow>>;
  getById(id: string): Promise<OfficeRow>;
  findByCode(code: string): Promise<OfficeRow | null>;
  insert(values: Record<string, unknown>): Promise<OfficeRow>;
  update(id: string, values: Record<string, unknown>): Promise<OfficeRow>;
  /** ids of offices referenced by any PR of the tenant (regardless of the caller's office scope) */
  officesInUse(): Promise<Set<string>>;
}

export const OFFICE_SORTABLE = ['code', 'nameAr', 'nameEn', 'createdAt'] as const;

export class OfficeRepository extends BaseRepository<Tables<'office'>> implements OfficeStore {
  constructor(ctx: RequestContext, db?: UserClient) {
    super(ctx, 'office', db);
  }

  listOffices(filter: ActiveListFilter): Promise<ListResponse<OfficeRow>> {
    return this.list({
      pagination: filter.pagination,
      sort: filter.sort,
      sortable: OFFICE_SORTABLE,
      defaultSort: { field: 'code', direction: 'asc' },
      filters: { isActive: filter.isActive },
    });
  }

  async findByCode(code: string): Promise<OfficeRow | null> {
    const { data } = await this.list({ pagination: { page: 1, pageSize: 1 }, filters: { code } });
    return data[0] ?? null;
  }

  async officesInUse(): Promise<Set<string>> {
    return withTenantTx(this.ctx, async ({ sql }) => {
      const rows = await sql<{ id: string }[]>`select app.offices_in_use() as id`;
      return new Set(rows.map((r) => r.id));
    });
  }
}
