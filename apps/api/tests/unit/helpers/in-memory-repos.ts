// In-memory stand-ins for repositories, with the same observable behaviour as BaseRepository:
// tenant scoping (other tenants' ids → NOT_FOUND), optimistic versioning (VERSION_CONFLICT),
// pagination and sorting. Services under unit test receive these instead of supabase-backed ones.
import { randomUUID } from 'node:crypto';
import type { ListResponse, Pagination, Sort } from '@ngo/shared';
import { AppError } from '../../../src/middleware/error';

export interface StoredRow {
  id: string;
  tenantId: string;
  version?: number;
  [key: string]: unknown;
}

export interface InMemoryListOptions {
  pagination: Pagination;
  sort?: Sort;
  filters?: Record<string, unknown>;
}

export class InMemoryRepository<T extends StoredRow> {
  readonly rows = new Map<string, T>();

  constructor(
    readonly tenantId: string,
    private readonly name = 'record'
  ) {}

  /** Seed rows directly, for any tenant (to test isolation). */
  seed(...rows: T[]): this {
    for (const row of rows) this.rows.set(row.id, structuredClone(row));
    return this;
  }

  private visible(): T[] {
    return [...this.rows.values()].filter((r) => r.tenantId === this.tenantId);
  }

  async list(options: InMemoryListOptions): Promise<ListResponse<T>> {
    let items = this.visible();
    for (const [field, value] of Object.entries(options.filters ?? {})) {
      if (value !== undefined) items = items.filter((r) => r[field] === value);
    }
    if (options.sort) {
      const { field, direction } = options.sort;
      const sign = direction === 'asc' ? 1 : -1;
      items = [...items].sort((a, b) => {
        const x = a[field] as string | number;
        const y = b[field] as string | number;
        return x < y ? -sign : x > y ? sign : 0;
      });
    }
    const { page, pageSize } = options.pagination;
    const start = (page - 1) * pageSize;
    return {
      data: items.slice(start, start + pageSize).map((r) => structuredClone(r)),
      page,
      pageSize,
      total: items.length,
    };
  }

  async findById(id: string): Promise<T | null> {
    const row = this.rows.get(id);
    return row && row.tenantId === this.tenantId ? structuredClone(row) : null;
  }

  async getById(id: string): Promise<T> {
    const row = await this.findById(id);
    if (!row) throw new AppError('NOT_FOUND', `${this.name} not found`);
    return row;
  }

  async insert(values: Omit<T, 'id' | 'tenantId'> & Partial<Pick<T, 'id'>>): Promise<T> {
    const row = {
      ...values,
      id: values.id ?? randomUUID(),
      tenantId: this.tenantId,
      ...('version' in values ? {} : { version: 1 }),
    } as T;
    this.rows.set(row.id, structuredClone(row));
    return structuredClone(row);
  }

  async update(id: string, values: Partial<T>, expectedVersion?: number): Promise<T> {
    const current = this.rows.get(id);
    if (!current || current.tenantId !== this.tenantId) {
      throw new AppError('NOT_FOUND', `${this.name} not found`);
    }
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
    const next = {
      ...current,
      ...values,
      id,
      tenantId: current.tenantId,
      version: (current.version ?? 1) + 1,
    } as T;
    this.rows.set(id, next);
    return structuredClone(next);
  }

  async delete(id: string): Promise<void> {
    const current = this.rows.get(id);
    if (!current || current.tenantId !== this.tenantId) {
      throw new AppError('NOT_FOUND', `${this.name} not found`);
    }
    this.rows.delete(id);
  }
}
