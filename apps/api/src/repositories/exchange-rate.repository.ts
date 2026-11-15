import type { ListResponse, Pagination, Sort } from '@ngo/shared';
import { withTenantTx, type TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import type { RequestContext } from '../types/context';
import { toSnake } from './base.repository';
import { TableAccess, raise, unwrap } from './query-helpers';

export interface RateRow {
  id: string;
  currency: string;
  rateToBase: string;
  rateDate: string;
  source: string;
  createdAt: string;
}

export type RateValues = Omit<RateRow, 'id' | 'createdAt'>;

export interface RateFilter {
  currency?: string;
  from?: string;
  to?: string;
}

/** Port used by ExchangeRateService; supabase-js / postgres below, in memory for unit tests. */
export interface ExchangeRateStore {
  list(filter: RateFilter, pagination: Pagination, sort?: Sort): Promise<ListResponse<RateRow>>;
  findById(id: string): Promise<RateRow | null>;
  insert(values: RateValues): Promise<RateRow>;
  update(id: string, values: Partial<RateValues>): Promise<RateRow>;
  delete(id: string): Promise<void>;
  /** Latest rate_date <= date; on the same date the latest entered (created_at) wins. */
  latestOnOrBefore(currency: string, date: string, tx?: TenantTx): Promise<RateRow | null>;
  /** The ids among `ids` referenced by any PR (all offices, migration 0010). */
  inUseIds(ids: readonly string[]): Promise<Set<string>>;
  baseCurrency(tx?: TenantTx): Promise<string>;
}

const COLUMNS = 'id,currency,rate_to_base::text,rate_date,source,created_at';
const SORTABLE = ['rateDate', 'currency', 'createdAt'];

interface RateDbRow {
  id: string;
  currency: string;
  rate_to_base: string;
  rate_date: string;
  source: string;
  created_at: string;
}

function toRate(r: RateDbRow): RateRow {
  return {
    id: r.id,
    currency: r.currency,
    rateToBase: r.rate_to_base,
    rateDate: r.rate_date,
    source: r.source,
    createdAt: r.created_at,
  };
}

function toRow(values: Partial<RateValues>): Record<string, unknown> {
  const row: Record<string, unknown> = {
    currency: values.currency,
    rate_to_base: values.rateToBase,
    rate_date: values.rateDate,
    source: values.source,
  };
  for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
  return row;
}

export class ExchangeRateRepository implements ExchangeRateStore {
  private readonly t: TableAccess;
  private readonly tenant: TableAccess;

  constructor(private readonly ctx: RequestContext) {
    this.t = new TableAccess(ctx, 'exchange_rate');
    this.tenant = new TableAccess(ctx, 'tenant', this.t.db);
  }

  async list(filter: RateFilter, pagination: Pagination, sort?: Sort) {
    const order = sort ?? { field: 'rateDate', direction: 'desc' as const };
    if (!SORTABLE.includes(order.field)) {
      throw new AppError('VALIDATION_ERROR', `Cannot sort by ${order.field}`, [
        { field: 'query.sort', message: 'unsupported_field' },
      ]);
    }
    let q = this.t.from().select(COLUMNS, { count: 'exact' });
    if (filter.currency) q = q.eq('currency', filter.currency);
    if (filter.from) q = q.gte('rate_date', filter.from);
    if (filter.to) q = q.lte('rate_date', filter.to);
    q = q
      .order(toSnake(order.field), { ascending: order.direction === 'asc' })
      .order('created_at', { ascending: false });

    const from = (pagination.page - 1) * pagination.pageSize;
    const result = await q.range(from, from + pagination.pageSize - 1);
    if (result.error) raise(result.error);
    return {
      data: ((result.data ?? []) as RateDbRow[]).map(toRate),
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: result.count ?? 0,
    };
  }

  async findById(id: string): Promise<RateRow | null> {
    const row = unwrap<RateDbRow>(await this.t.from().select(COLUMNS).eq('id', id).maybeSingle());
    return row ? toRate(row) : null;
  }

  async insert(values: RateValues): Promise<RateRow> {
    const row = unwrap<RateDbRow>(
      await this.t
        .from()
        .insert({ ...toRow(values), tenant_id: this.ctx.tenantId })
        .select(COLUMNS)
        .single()
    );
    return toRate(row!);
  }

  async update(id: string, values: Partial<RateValues>): Promise<RateRow> {
    const row = unwrap<RateDbRow>(
      await this.t.from().update(toRow(values)).eq('id', id).select(COLUMNS).maybeSingle()
    );
    if (!row) throw new AppError('NOT_FOUND', 'exchange_rate not found');
    return toRate(row);
  }

  async delete(id: string): Promise<void> {
    const result = await this.t.from().delete().eq('id', id).select('id');
    if (result.error) raise(result.error);
    if (!result.data || result.data.length === 0) {
      throw new AppError('NOT_FOUND', 'exchange_rate not found');
    }
  }

  async latestOnOrBefore(currency: string, date: string, tx?: TenantTx) {
    if (tx) {
      const [row] = await tx.sql<RateDbRow[]>`
        select id, currency::text as currency, rate_to_base::text as rate_to_base,
               rate_date::text as rate_date, source, created_at::text as created_at
        from public.exchange_rate
        where currency = ${currency} and rate_date <= ${date}
        order by rate_date desc, created_at desc, id desc
        limit 1`;
      return row ? toRate(row) : null;
    }
    const row = unwrap<RateDbRow>(
      await this.t
        .from()
        .select(COLUMNS)
        .eq('currency', currency)
        .lte('rate_date', date)
        .order('rate_date', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle()
    );
    return row ? toRate(row) : null;
  }

  async inUseIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    return withTenantTx(this.ctx, async ({ sql }) => {
      const rows = await sql<{ id: string }[]>`
        select id from app.exchange_rates_in_use(${[...ids]}::uuid[]) as id`;
      return new Set(rows.map((r) => r.id));
    });
  }

  async baseCurrency(tx?: TenantTx): Promise<string> {
    if (tx) {
      const [row] = await tx.sql<{ base_currency: string }[]>`
        select base_currency::text as base_currency from public.tenant
        where id = ${this.ctx.tenantId}`;
      if (!row) throw new AppError('NOT_FOUND', 'tenant not found');
      return row.base_currency;
    }
    const row = unwrap<{ base_currency: string }>(
      await this.tenant.from().select('base_currency').eq('id', this.ctx.tenantId).maybeSingle()
    );
    if (!row) throw new AppError('NOT_FOUND', 'tenant not found');
    return row.base_currency;
  }
}
