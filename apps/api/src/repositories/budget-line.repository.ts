import type { BudgetCategory, BudgetLine } from '@ngo/shared';
import type { TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import type { RequestContext } from '../types/context';
import { TableAccess, unwrap, unwrapList } from './query-helpers';

export type BudgetLineValues = Omit<BudgetLine, 'id' | 'version' | 'isActive'> & {
  isActive?: boolean;
};

/** Open (not released) amounts on a budget line, decimal strings in the grant currency. */
export interface BudgetUsage {
  reserved: string;
  committed: string;
}

/** Budget line read under `FOR UPDATE`, with its grant currency. */
export interface LockedBudgetLine {
  id: string;
  grantId: string;
  code: string;
  budgetAmount: string;
  currency: string;
  version: number;
}

export type CommitmentStatus = 'reserved' | 'committed' | 'released';
export type ReleaseReason = 'returned' | 'rejected' | 'cancelled' | 'budget_line_changed';

export interface CommitmentRow {
  id: string;
  prId: string;
  budgetLineId: string;
  cycle: number;
  amount: string;
  status: CommitmentStatus;
}

export interface CommitmentPatch {
  amount?: string;
  status?: CommitmentStatus;
  releaseReason?: ReleaseReason | null;
}

/** Plain CRUD and reads (supabase-js, RLS). */
export interface BudgetLineStore {
  listByGrant(grantId: string): Promise<BudgetLine[]>;
  findById(id: string): Promise<BudgetLine | null>;
  findByCode(grantId: string, code: string): Promise<BudgetLine | null>;
  insert(values: BudgetLineValues): Promise<BudgetLine>;
  /** One statement, so all rows or none. Returns the number created. */
  insertMany(rows: BudgetLineValues[]): Promise<number>;
  update(
    id: string,
    values: Partial<BudgetLineValues>,
    expectedVersion: number
  ): Promise<BudgetLine>;
  /** Reserved / committed per budget line of the grant (budget_line_balance). */
  usageByGrant(grantId: string): Promise<Map<string, BudgetUsage>>;
}

/** Statements that must run inside a PR command or amount edit transaction (research R4). */
export interface BudgetTxStore {
  /** `FOR UPDATE` in ascending id order (no deadlocks); missing ids are simply absent. */
  lockLines(tx: TenantTx, ids: readonly string[]): Promise<LockedBudgetLine[]>;
  usage(
    tx: TenantTx,
    ids: readonly string[],
    options?: { excludePrId?: string }
  ): Promise<Map<string, BudgetUsage>>;
  updateLine(
    tx: TenantTx,
    id: string,
    values: Partial<BudgetLineValues>,
    expectedVersion: number
  ): Promise<BudgetLine>;
  listCommitments(tx: TenantTx, prId: string): Promise<CommitmentRow[]>;
  insertCommitment(tx: TenantTx, row: Omit<CommitmentRow, 'id' | 'status'>): Promise<CommitmentRow>;
  updateCommitment(tx: TenantTx, id: string, patch: CommitmentPatch): Promise<CommitmentRow>;
}

const COLUMNS =
  'id,grant_id,code,description,category,budget_amount::text,office_id,is_active,version';

interface BudgetLineRow {
  id: string;
  grant_id: string;
  code: string;
  description: string;
  category: BudgetCategory;
  budget_amount: string;
  office_id: string | null;
  is_active: boolean;
  version: number;
}

function toBudgetLine(r: BudgetLineRow): BudgetLine {
  return {
    id: r.id,
    grantId: r.grant_id,
    code: r.code,
    description: r.description,
    category: r.category,
    budgetAmount: r.budget_amount,
    officeId: r.office_id,
    isActive: r.is_active,
    version: r.version,
  };
}

function toRow(values: Partial<BudgetLineValues>): Record<string, unknown> {
  const row: Record<string, unknown> = {
    grant_id: values.grantId,
    code: values.code,
    description: values.description,
    category: values.category,
    budget_amount: values.budgetAmount,
    office_id: values.officeId,
    is_active: values.isActive,
  };
  for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
  return row;
}

export class BudgetLineRepository implements BudgetLineStore {
  private readonly t: TableAccess;
  private readonly balance: TableAccess;

  constructor(private readonly ctx: RequestContext) {
    this.t = new TableAccess(ctx, 'budget_line');
    this.balance = new TableAccess(ctx, 'budget_line_balance', this.t.db);
  }

  async listByGrant(grantId: string): Promise<BudgetLine[]> {
    const rows = unwrapList<BudgetLineRow>(
      await this.t.from().select(COLUMNS).eq('grant_id', grantId).order('code')
    );
    return rows.map(toBudgetLine);
  }

  async findById(id: string): Promise<BudgetLine | null> {
    const row = unwrap<BudgetLineRow>(
      await this.t.from().select(COLUMNS).eq('id', id).maybeSingle()
    );
    return row ? toBudgetLine(row) : null;
  }

  async findByCode(grantId: string, code: string): Promise<BudgetLine | null> {
    const row = unwrap<BudgetLineRow>(
      await this.t.from().select(COLUMNS).eq('grant_id', grantId).eq('code', code).maybeSingle()
    );
    return row ? toBudgetLine(row) : null;
  }

  async insert(values: BudgetLineValues): Promise<BudgetLine> {
    const row = unwrap<BudgetLineRow>(
      await this.t
        .from()
        .insert({ ...toRow(values), tenant_id: this.ctx.tenantId })
        .select(COLUMNS)
        .single()
    );
    return toBudgetLine(row!);
  }

  async insertMany(rows: BudgetLineValues[]): Promise<number> {
    if (rows.length === 0) return 0;
    const created = unwrapList<{ id: string }>(
      await this.t
        .from()
        .insert(rows.map((r) => ({ ...toRow(r), tenant_id: this.ctx.tenantId })))
        .select('id')
    );
    return created.length;
  }

  async update(id: string, values: Partial<BudgetLineValues>, expectedVersion: number) {
    const row = unwrap<BudgetLineRow>(
      await this.t
        .from()
        .update(toRow(values))
        .eq('id', id)
        .eq('version', expectedVersion)
        .select(COLUMNS)
        .maybeSingle()
    );
    if (row) return toBudgetLine(row);
    if (await this.findById(id)) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
    throw new AppError('NOT_FOUND', 'budget_line not found');
  }

  async usageByGrant(grantId: string): Promise<Map<string, BudgetUsage>> {
    const rows = unwrapList<{ budget_line_id: string; reserved: string; committed: string }>(
      await this.balance
        .from()
        .select('budget_line_id,reserved::text,committed::text')
        .eq('grant_id', grantId)
    );
    return new Map(
      rows.map((r) => [r.budget_line_id, { reserved: r.reserved, committed: r.committed }])
    );
  }
}

interface CommitmentDbRow {
  id: string;
  pr_id: string;
  budget_line_id: string;
  cycle: number;
  amount: string;
  status: CommitmentStatus;
}

function toCommitment(r: CommitmentDbRow): CommitmentRow {
  return {
    id: r.id,
    prId: r.pr_id,
    budgetLineId: r.budget_line_id,
    cycle: r.cycle,
    amount: r.amount,
    status: r.status,
  };
}

/** postgres-driver implementation; numeric columns arrive as strings. */
export class BudgetTxRepository implements BudgetTxStore {
  constructor(private readonly ctx: RequestContext) {}

  async lockLines(tx: TenantTx, ids: readonly string[]): Promise<LockedBudgetLine[]> {
    if (ids.length === 0) return [];
    const sorted = [...new Set(ids)].sort();
    const rows = await tx.sql<
      {
        id: string;
        grant_id: string;
        code: string;
        budget_amount: string;
        currency: string;
        version: number;
      }[]
    >`
      select b.id, b.grant_id, b.code, b.budget_amount::text as budget_amount,
             g.currency::text as currency, b.version
      from public.budget_line b
      join public."grant" g on g.id = b.grant_id
      where b.id in ${tx.sql(sorted)}
      order by b.id
      for update of b`;
    return rows.map((r) => ({
      id: r.id,
      grantId: r.grant_id,
      code: r.code,
      budgetAmount: r.budget_amount,
      currency: r.currency,
      version: r.version,
    }));
  }

  async usage(tx: TenantTx, ids: readonly string[], options: { excludePrId?: string } = {}) {
    const usage = new Map<string, BudgetUsage>();
    if (ids.length === 0) return usage;
    const exclude = options.excludePrId ?? null;
    const rows = await tx.sql<{ budget_line_id: string; reserved: string; committed: string }[]>`
      select c.budget_line_id,
             coalesce(sum(c.amount) filter (where c.status = 'reserved'), 0)::text as reserved,
             coalesce(sum(c.amount) filter (where c.status = 'committed'), 0)::text as committed
      from public.budget_commitment c
      where c.budget_line_id in ${tx.sql([...new Set(ids)])}
        and c.status in ('reserved', 'committed')
        -- non-PR rows have no pr_id (002): they always count
        and (${exclude}::uuid is null or c.pr_id is distinct from ${exclude}::uuid)
      group by c.budget_line_id`;
    for (const r of rows) {
      usage.set(r.budget_line_id, { reserved: r.reserved, committed: r.committed });
    }
    return usage;
  }

  async updateLine(
    tx: TenantTx,
    id: string,
    values: Partial<BudgetLineValues>,
    expectedVersion: number
  ): Promise<BudgetLine> {
    const changes = toRow(values);
    const keys = Object.keys(changes);
    const rows = keys.length
      ? await tx.sql<BudgetLineRow[]>`
          update public.budget_line set ${tx.sql(changes as Record<string, string | boolean | null>, keys)}
          where id = ${id} and version = ${expectedVersion}
          returning id, grant_id, code, description, category,
                    budget_amount::text as budget_amount, office_id, is_active, version`
      : await tx.sql<BudgetLineRow[]>`
          select id, grant_id, code, description, category,
                 budget_amount::text as budget_amount, office_id, is_active, version
          from public.budget_line where id = ${id} and version = ${expectedVersion}`;
    if (rows[0]) return toBudgetLine(rows[0]);

    const [exists] = await tx.sql`select 1 from public.budget_line where id = ${id}`;
    if (exists) throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    throw new AppError('NOT_FOUND', 'budget_line not found');
  }

  async listCommitments(tx: TenantTx, prId: string): Promise<CommitmentRow[]> {
    const rows = await tx.sql<CommitmentDbRow[]>`
      select id, pr_id, budget_line_id, cycle, amount::text as amount, status
      from public.budget_commitment
      where pr_id = ${prId}
      order by cycle, budget_line_id`;
    return rows.map(toCommitment);
  }

  async insertCommitment(
    tx: TenantTx,
    row: Omit<CommitmentRow, 'id' | 'status'>
  ): Promise<CommitmentRow> {
    const [created] = await tx.sql<CommitmentDbRow[]>`
      insert into public.budget_commitment (tenant_id, budget_line_id, pr_id, cycle, amount)
      values (${this.ctx.tenantId}, ${row.budgetLineId}, ${row.prId}, ${row.cycle}, ${row.amount})
      returning id, pr_id, budget_line_id, cycle, amount::text as amount, status`;
    return toCommitment(created!);
  }

  async updateCommitment(tx: TenantTx, id: string, patch: CommitmentPatch) {
    const status = patch.status ?? null;
    const [row] = await tx.sql<CommitmentDbRow[]>`
      update public.budget_commitment set
        amount = coalesce(${patch.amount ?? null}::numeric, amount),
        status = coalesce(${status}::text, status),
        committed_at = case when ${status}::text = 'committed' then now() else committed_at end,
        released_at = case
          when ${status}::text = 'released' then now()
          when ${status}::text is not null then null
          else released_at end,
        release_reason = case
          when ${status}::text = 'released' then ${patch.releaseReason ?? null}::text
          when ${status}::text is not null then null
          else release_reason end,
        reserved_at = case when ${status}::text = 'reserved' then now() else reserved_at end
      where id = ${id}
      returning id, pr_id, budget_line_id, cycle, amount::text as amount, status`;
    if (!row) throw new AppError('NOT_FOUND', 'budget_commitment not found');
    return toCommitment(row);
  }
}
