// Offices / locations (FR-002). Never hard-deleted: deactivate with isActive=false. The code is
// immutable once a PR references the office; the office_code_immutable_when_used trigger is the
// backstop and its error maps to the same 409 OFFICE_CODE_IN_USE.
import type {
  CreateOfficeInput,
  ListResponse,
  Office,
  Pagination,
  Sort,
  UpdateOfficeInput,
} from '@ngo/shared';
import { AppError } from '../middleware/error';
import type { OfficeRow, OfficeStore } from '../repositories/office.repository';

function toOffice(row: OfficeRow, inUse: Set<string>): Office {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    address: row.address,
    phone: row.phone,
    isActive: row.isActive,
    codeLocked: inUse.has(row.id),
  };
}

export function codeTaken(): AppError<'VALIDATION_ERROR'> {
  return new AppError('VALIDATION_ERROR', 'The code is already used', [
    { field: 'code', message: 'already_exists' },
  ]);
}

export class OfficeService {
  constructor(private readonly store: OfficeStore) {}

  async list(query: {
    pagination: Pagination;
    sort?: Sort;
    active?: boolean;
  }): Promise<ListResponse<Office>> {
    const [page, inUse] = await Promise.all([
      this.store.listOffices({
        pagination: query.pagination,
        sort: query.sort,
        isActive: query.active,
      }),
      this.store.officesInUse(),
    ]);
    return { ...page, data: page.data.map((row) => toOffice(row, inUse)) };
  }

  async get(id: string): Promise<Office> {
    const [row, inUse] = await Promise.all([this.store.getById(id), this.store.officesInUse()]);
    return toOffice(row, inUse);
  }

  async create(input: CreateOfficeInput): Promise<Office> {
    if (await this.store.findByCode(input.code)) throw codeTaken();
    const row = await this.store.insert({ ...input });
    return toOffice(row, new Set());
  }

  async update(id: string, input: UpdateOfficeInput): Promise<Office> {
    const current = await this.store.getById(id);
    const inUse = await this.store.officesInUse();

    if (input.code !== undefined && input.code !== current.code) {
      if (inUse.has(id)) {
        throw new AppError(
          'OFFICE_CODE_IN_USE',
          'The office is referenced by purchase requisitions; its code cannot change'
        );
      }
      const other = await this.store.findByCode(input.code);
      if (other && other.id !== id) throw codeTaken();
    }

    const row = await this.store.update(id, { ...input });
    return toOffice(row, inUse);
  }
}
