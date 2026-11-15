import type { Grant, GrantStatus, ListResponse, Pagination, Sort } from '@ngo/shared';
import { withTenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import type { RequestContext } from '../types/context';
import { toSnake } from './base.repository';
import { TableAccess, raise, unwrap, unwrapList } from './query-helpers';

export interface GrantFilter {
  status?: GrantStatus;
  donorId?: string;
  /** grant operates in this office (grant_office) */
  officeId?: string;
  /** start_date <= date <= end_date */
  coversDate?: string;
}

export type GrantValues = Omit<Grant, 'id' | 'version' | 'officeIds' | 'status'> & {
  status?: GrantStatus;
};

/** Port used by GrantService; implemented over supabase-js below and in memory for unit tests. */
export interface GrantStore {
  search(filter: GrantFilter, pagination: Pagination, sort?: Sort): Promise<ListResponse<Grant>>;
  findById(id: string): Promise<Grant | null>;
  findByCode(code: string): Promise<Grant | null>;
  insert(values: GrantValues): Promise<Grant>;
  /** With expectedVersion: 409 VERSION_CONFLICT when stale. */
  update(id: string, values: Partial<GrantValues>, expectedVersion?: number): Promise<Grant>;
  /** Replaces the offices where the grant operates. */
  setOffices(grantId: string, officeIds: readonly string[]): Promise<void>;
  /** Sum of the grant's budget lines (grant_summary). */
  budgetLinesTotal(grantId: string): Promise<string>;
  /** Submitted, undecided PRs on the grant, across all offices (FR-022). */
  pendingPrCount(grantId: string): Promise<number>;
  /** Any budget_commitment row on any of the grant's budget lines. */
  hasCommitments(grantId: string): Promise<boolean>;
}

const COLUMNS =
  'id,donor_id,code,name,currency,total_amount::text,start_date,end_date,status,version,' +
  'grant_office(office_id)';

const SORTABLE = ['code', 'name', 'startDate', 'endDate', 'status', 'createdAt'];

interface GrantRow {
  id: string;
  donor_id: string;
  code: string;
  name: string;
  currency: string;
  total_amount: string;
  start_date: string;
  end_date: string;
  status: GrantStatus;
  version: number;
  grant_office?: { office_id: string }[];
}

function toGrant(r: GrantRow): Grant {
  return {
    id: r.id,
    donorId: r.donor_id,
    code: r.code,
    name: r.name,
    currency: r.currency,
    totalAmount: r.total_amount,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
    version: r.version,
    officeIds: (r.grant_office ?? []).map((o) => o.office_id).sort(),
  };
}

function toRow(values: Partial<GrantValues>): Record<string, unknown> {
  const row: Record<string, unknown> = {
    donor_id: values.donorId,
    code: values.code,
    name: values.name,
    currency: values.currency,
    total_amount: values.totalAmount,
    start_date: values.startDate,
    end_date: values.endDate,
    status: values.status,
  };
  for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
  return row;
}

export class GrantRepository implements GrantStore {
  private readonly t: TableAccess;
  private readonly offices: TableAccess;
  private readonly summary: TableAccess;
  private readonly commitments: TableAccess;

  constructor(private readonly ctx: RequestContext) {
    this.t = new TableAccess(ctx, 'grant');
    this.offices = new TableAccess(ctx, 'grant_office', this.t.db);
    this.summary = new TableAccess(ctx, 'grant_summary', this.t.db);
    this.commitments = new TableAccess(ctx, 'budget_commitment', this.t.db);
  }

  async search(filter: GrantFilter, pagination: Pagination, sort?: Sort) {
    const order = sort ?? { field: 'code', direction: 'asc' as const };
    if (!SORTABLE.includes(order.field)) {
      throw new AppError('VALIDATION_ERROR', `Cannot sort by ${order.field}`, [
        { field: 'query.sort', message: 'unsupported_field' },
      ]);
    }

    let grantIds: string[] | undefined;
    if (filter.officeId) {
      const rows = unwrapList<{ grant_id: string }>(
        await this.offices.from().select('grant_id').eq('office_id', filter.officeId)
      );
      grantIds = rows.map((r) => r.grant_id);
      if (grantIds.length === 0) {
        return { data: [], page: pagination.page, pageSize: pagination.pageSize, total: 0 };
      }
    }

    let q = this.t.from().select(COLUMNS, { count: 'exact' });
    if (filter.status) q = q.eq('status', filter.status);
    if (filter.donorId) q = q.eq('donor_id', filter.donorId);
    if (grantIds) q = q.in('id', grantIds);
    if (filter.coversDate) {
      q = q.lte('start_date', filter.coversDate).gte('end_date', filter.coversDate);
    }
    q = q.order(toSnake(order.field), { ascending: order.direction === 'asc' });

    const from = (pagination.page - 1) * pagination.pageSize;
    const result = await q.range(from, from + pagination.pageSize - 1);
    if (result.error) raise(result.error);
    return {
      data: ((result.data ?? []) as GrantRow[]).map(toGrant),
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: result.count ?? 0,
    };
  }

  async findById(id: string): Promise<Grant | null> {
    const row = unwrap<GrantRow>(await this.t.from().select(COLUMNS).eq('id', id).maybeSingle());
    return row ? toGrant(row) : null;
  }

  async findByCode(code: string): Promise<Grant | null> {
    const row = unwrap<GrantRow>(
      await this.t.from().select(COLUMNS).eq('code', code).maybeSingle()
    );
    return row ? toGrant(row) : null;
  }

  async insert(values: GrantValues): Promise<Grant> {
    const row = unwrap<GrantRow>(
      await this.t
        .from()
        .insert({ ...toRow(values), tenant_id: this.ctx.tenantId })
        .select(COLUMNS)
        .single()
    );
    return toGrant(row!);
  }

  async update(id: string, values: Partial<GrantValues>, expectedVersion?: number) {
    let q = this.t.from().update(toRow(values)).eq('id', id);
    if (expectedVersion !== undefined) q = q.eq('version', expectedVersion);
    const row = unwrap<GrantRow>(await q.select(COLUMNS).maybeSingle());
    if (row) return toGrant(row);
    if (expectedVersion !== undefined && (await this.findById(id))) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
    throw new AppError('NOT_FOUND', 'grant not found');
  }

  async setOffices(grantId: string, officeIds: readonly string[]): Promise<void> {
    const wanted = new Set(officeIds);
    const current = unwrapList<{ id: string; office_id: string }>(
      await this.offices.from().select('id,office_id').eq('grant_id', grantId)
    );
    const remove = current.filter((r) => !wanted.has(r.office_id)).map((r) => r.id);
    const have = new Set(current.map((r) => r.office_id));
    const add = [...wanted].filter((id) => !have.has(id));

    if (add.length) {
      unwrap(
        await this.offices.from().insert(
          add.map((officeId) => ({
            tenant_id: this.ctx.tenantId,
            grant_id: grantId,
            office_id: officeId,
          }))
        )
      );
    }
    if (remove.length) unwrap(await this.offices.from().delete().in('id', remove));
  }

  async budgetLinesTotal(grantId: string): Promise<string> {
    const row = unwrap<{ budget_lines_total: string | null }>(
      await this.summary
        .from()
        .select('budget_lines_total::text')
        .eq('grant_id', grantId)
        .maybeSingle()
    );
    return row?.budget_lines_total ?? '0.00';
  }

  pendingPrCount(grantId: string): Promise<number> {
    return withTenantTx(this.ctx, async ({ sql }) => {
      const [row] = await sql<{ n: number }[]>`select app.grant_pending_pr_count(${grantId}) as n`;
      return row?.n ?? 0;
    });
  }

  async hasCommitments(grantId: string): Promise<boolean> {
    const result = await this.commitments
      .from()
      .select('id, budget_line!inner(grant_id)', { count: 'exact', head: true })
      .eq('budget_line.grant_id', grantId);
    if (result.error) raise(result.error);
    return (result.count ?? 0) > 0;
  }
}
