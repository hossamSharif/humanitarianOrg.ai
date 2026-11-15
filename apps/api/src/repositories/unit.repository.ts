// Units of measure of the caller's tenant (RLS-scoped).
import type { Tables } from '@ngo/database';
import type { ListResponse } from '@ngo/shared';
import type { UserClient } from '../db/supabase';
import type { RequestContext } from '../types/context';
import { BaseRepository, type Camelized } from './base.repository';
import type { ActiveListFilter } from './office.repository';

export type UnitRow = Camelized<Tables<'unit_of_measure'>>;

export interface UnitStore {
  listUnits(filter: ActiveListFilter): Promise<ListResponse<UnitRow>>;
  getById(id: string): Promise<UnitRow>;
  findByCode(code: string): Promise<UnitRow | null>;
  insert(values: Record<string, unknown>): Promise<UnitRow>;
  update(id: string, values: Record<string, unknown>): Promise<UnitRow>;
}

export const UNIT_SORTABLE = ['code', 'nameAr', 'nameEn', 'createdAt'] as const;

export class UnitRepository extends BaseRepository<Tables<'unit_of_measure'>> implements UnitStore {
  constructor(ctx: RequestContext, db?: UserClient) {
    super(ctx, 'unit_of_measure', db);
  }

  listUnits(filter: ActiveListFilter): Promise<ListResponse<UnitRow>> {
    return this.list({
      pagination: filter.pagination,
      sort: filter.sort,
      sortable: UNIT_SORTABLE,
      defaultSort: { field: 'code', direction: 'asc' },
      filters: { isActive: filter.isActive },
    });
  }

  async findByCode(code: string): Promise<UnitRow | null> {
    const { data } = await this.list({ pagination: { page: 1, pageSize: 1 }, filters: { code } });
    return data[0] ?? null;
  }
}
