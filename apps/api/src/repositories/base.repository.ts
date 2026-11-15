// Tenant-scoped CRUD over supabase-js with the caller's token (RLS applies). Rows cross the
// repository boundary in camelCase; the database speaks snake_case.
import type { Database } from '@ngo/database';
import type { ListResponse, Pagination, Sort } from '@ngo/shared';
import { createUserClient, type UserClient } from '../db/supabase';
import { AppError, fromPostgresError } from '../middleware/error';
import type { RequestContext } from '../types/context';

export type TableName = keyof Database['public']['Tables'] | keyof Database['public']['Views'];

type CamelCase<S extends string> = S extends `${infer H}_${infer T}`
  ? `${H}${Capitalize<CamelCase<T>>}`
  : S;

/** Row type with camelCase keys. */
export type Camelized<T> = { [K in keyof T as K extends string ? CamelCase<K> : K]: T[K] };

export function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function camelizeRow<T extends Record<string, unknown>>(row: T): Camelized<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out as Camelized<T>;
}

/** camelCase → snake_case; `undefined` values are dropped so PATCHes only touch sent fields. */
export function snakeizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v !== undefined) out[toSnake(k)] = v;
  }
  return out;
}

interface PostgrestLikeError {
  code?: string;
  message: string;
  details?: string | null;
}

function raise(error: PostgrestLikeError): never {
  throw fromPostgresError(error) ?? new AppError('INTERNAL_ERROR', error.message);
}

export interface ListOptions {
  pagination: Pagination;
  sort?: Sort;
  /** camelCase field → allowed DB column; sorting by anything else is rejected */
  sortable?: readonly string[];
  defaultSort?: Sort;
  /** equality filters, camelCase keys */
  filters?: Record<string, string | number | boolean | null | undefined>;
  select?: string;
}

export class BaseRepository<Row extends Record<string, unknown>> {
  protected readonly db: UserClient;

  constructor(
    protected readonly ctx: RequestContext,
    protected readonly table: TableName,
    db?: UserClient
  ) {
    this.db = db ?? createUserClient(ctx.accessToken);
  }

  // supabase-js generics cannot express a table chosen at runtime; the casts stay in this class.
  protected query() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.db as any).from(this.table);
  }

  async list(options: ListOptions): Promise<ListResponse<Camelized<Row>>> {
    const { page, pageSize } = options.pagination;
    const sort = options.sort ?? options.defaultSort;
    if (sort && options.sortable && !options.sortable.includes(sort.field)) {
      throw new AppError('VALIDATION_ERROR', `Cannot sort by ${sort.field}`, [
        { field: 'query.sort', message: 'unsupported_field' },
      ]);
    }

    let q = this.query().select(options.select ?? '*', { count: 'exact' });
    for (const [field, value] of Object.entries(options.filters ?? {})) {
      if (value === undefined) continue;
      q = value === null ? q.is(toSnake(field), null) : q.eq(toSnake(field), value);
    }
    if (sort) q = q.order(toSnake(sort.field), { ascending: sort.direction === 'asc' });

    const from = (page - 1) * pageSize;
    const { data, error, count } = await q.range(from, from + pageSize - 1);
    if (error) raise(error);
    return {
      data: (data as Row[]).map((r) => camelizeRow(r)),
      page,
      pageSize,
      total: count ?? 0,
    };
  }

  /** 404 NOT_FOUND also for ids of other tenants (RLS hides them). */
  async getById(id: string, select = '*'): Promise<Camelized<Row>> {
    const { data, error } = await this.query().select(select).eq('id', id).maybeSingle();
    if (error) raise(error);
    if (!data) throw new AppError('NOT_FOUND', `${this.table} not found`);
    return camelizeRow(data as Row);
  }

  async findById(id: string, select = '*'): Promise<Camelized<Row> | null> {
    const { data, error } = await this.query().select(select).eq('id', id).maybeSingle();
    if (error) raise(error);
    return data ? camelizeRow(data as Row) : null;
  }

  /** Inserts with the caller's tenant_id. */
  async insert(values: Record<string, unknown>): Promise<Camelized<Row>> {
    const { data, error } = await this.query()
      .insert({ ...snakeizeRow(values), tenant_id: this.ctx.tenantId })
      .select()
      .single();
    if (error) raise(error);
    return camelizeRow(data as Row);
  }

  /**
   * Updates one row. With `expectedVersion` the row must still be at that version, else
   * 409 VERSION_CONFLICT (the bump_version trigger increments it).
   */
  async update(
    id: string,
    values: Record<string, unknown>,
    expectedVersion?: number
  ): Promise<Camelized<Row>> {
    const { tenantId: _t, tenant_id: _t2, id: _id, version: _v, ...rest } = values;
    let q = this.query().update(snakeizeRow(rest)).eq('id', id);
    if (expectedVersion !== undefined) q = q.eq('version', expectedVersion);
    const { data, error } = await q.select().maybeSingle();
    if (error) raise(error);
    if (data) return camelizeRow(data as Row);

    if (expectedVersion !== undefined && (await this.findById(id, 'id'))) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
    throw new AppError('NOT_FOUND', `${this.table} not found`);
  }

  async delete(id: string): Promise<void> {
    const { data, error } = await this.query().delete().eq('id', id).select('id');
    if (error) raise(error);
    if (!data || (data as unknown[]).length === 0) {
      throw new AppError('NOT_FOUND', `${this.table} not found`);
    }
  }
}
