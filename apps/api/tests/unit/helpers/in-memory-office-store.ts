// In-memory office and unit stores on top of InMemoryRepository; `inUse` stands in for offices
// referenced by PRs (app.offices_in_use()).
import type {
  ActiveListFilter,
  OfficeRow,
  OfficeStore,
} from '../../../src/repositories/office.repository';
import type { UnitRow, UnitStore } from '../../../src/repositories/unit.repository';
import { InMemoryRepository, type StoredRow } from './in-memory-repos';

type OfficeStored = OfficeRow & StoredRow;
type UnitStored = UnitRow & StoredRow;

const timestamps = () => {
  const now = new Date().toISOString();
  return { createdAt: now, updatedAt: now, createdBy: null };
};

export class InMemoryOfficeStore extends InMemoryRepository<OfficeStored> implements OfficeStore {
  readonly inUse = new Set<string>();

  constructor(tenantId: string) {
    super(tenantId, 'office');
  }

  listOffices(filter: ActiveListFilter) {
    return this.list({
      pagination: filter.pagination,
      sort: filter.sort ?? { field: 'code', direction: 'asc' },
      filters: { isActive: filter.isActive },
    });
  }

  async findByCode(code: string) {
    return (
      (await this.list({ pagination: { page: 1, pageSize: 200 }, filters: { code } })).data[0] ??
      null
    );
  }

  override insert(values: Record<string, unknown>) {
    return super.insert({ address: null, phone: null, ...timestamps(), ...values } as never);
  }

  override update(id: string, values: Record<string, unknown>) {
    return super.update(id, values as Partial<OfficeStored>);
  }

  async officesInUse() {
    return new Set(this.inUse);
  }
}

export class InMemoryUnitStore extends InMemoryRepository<UnitStored> implements UnitStore {
  constructor(tenantId: string) {
    super(tenantId, 'unit_of_measure');
  }

  listUnits(filter: ActiveListFilter) {
    return this.list({
      pagination: filter.pagination,
      sort: filter.sort ?? { field: 'code', direction: 'asc' },
      filters: { isActive: filter.isActive },
    });
  }

  async findByCode(code: string) {
    return (
      (await this.list({ pagination: { page: 1, pageSize: 200 }, filters: { code } })).data[0] ??
      null
    );
  }

  override insert(values: Record<string, unknown>) {
    return super.insert({ ...timestamps(), ...values } as never);
  }

  override update(id: string, values: Record<string, unknown>) {
    return super.update(id, values as Partial<UnitStored>);
  }
}
