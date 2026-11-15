// Units of measure (FR-003). Seeded on tenant creation; editable; never hard-deleted —
// deactivate with isActive=false so PR lines keep their unit.
import type {
  CreateUnitInput,
  ListResponse,
  Pagination,
  Sort,
  UnitOfMeasure,
  UpdateUnitInput,
} from '@ngo/shared';
import type { UnitRow, UnitStore } from '../repositories/unit.repository';
import { codeTaken } from './office.service';

function toUnit(row: UnitRow): UnitOfMeasure {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    isActive: row.isActive,
  };
}

export class UnitService {
  constructor(private readonly store: UnitStore) {}

  async list(query: {
    pagination: Pagination;
    sort?: Sort;
    active?: boolean;
  }): Promise<ListResponse<UnitOfMeasure>> {
    const page = await this.store.listUnits({
      pagination: query.pagination,
      sort: query.sort,
      isActive: query.active,
    });
    return { ...page, data: page.data.map(toUnit) };
  }

  async create(input: CreateUnitInput): Promise<UnitOfMeasure> {
    if (await this.store.findByCode(input.code)) throw codeTaken();
    return toUnit(await this.store.insert({ ...input }));
  }

  async update(id: string, input: UpdateUnitInput): Promise<UnitOfMeasure> {
    const current = await this.store.getById(id);
    if (input.code !== undefined && input.code !== current.code) {
      const other = await this.store.findByCode(input.code);
      if (other && other.id !== id) throw codeTaken();
    }
    return toUnit(await this.store.update(id, { ...input }));
  }
}
