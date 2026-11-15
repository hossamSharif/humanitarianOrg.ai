// In-memory funding stores for unit tests of the US2 services: donors, grants (with offices,
// pending-PR counts and commitments), budget lines with a shared commitment ledger, exchange
// rates and activities. Behaviour mirrors the SQL repositories (version checks, NOT_FOUND,
// latest-rate ordering, lock order).
import { randomUUID } from 'node:crypto';
import {
  Decimal,
  type Activity,
  type BudgetLine,
  type Donor,
  type Grant,
  type ListResponse,
  type Pagination,
} from '@ngo/shared';
import type { TenantTx } from '../../../src/db/tx';
import { AppError } from '../../../src/middleware/error';
import type { ActivityStore, ActivityValues } from '../../../src/repositories/activity.repository';
import type {
  BudgetLineStore,
  BudgetLineValues,
  BudgetTxStore,
  BudgetUsage,
  CommitmentPatch,
  CommitmentRow,
} from '../../../src/repositories/budget-line.repository';
import type { DonorStore, DonorValues } from '../../../src/repositories/donor.repository';
import type {
  ExchangeRateStore,
  RateFilter,
  RateRow,
  RateValues,
} from '../../../src/repositories/exchange-rate.repository';
import type {
  GrantFilter,
  GrantStore,
  GrantValues,
} from '../../../src/repositories/grant.repository';
import { MAD_OFFICE_ID } from './builders';

/** Stand-in for the transaction handle; the fakes never touch it. */
export const FAKE_TX = { sql: null, setAuditComment: async () => {} } as unknown as TenantTx;

export function runFakeTx<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return fn(FAKE_TX);
}

function paginate<T>(items: T[], { page, pageSize }: Pagination): ListResponse<T> {
  const start = (page - 1) * pageSize;
  return { data: items.slice(start, start + pageSize), page, pageSize, total: items.length };
}

const clone = <T>(v: T): T => structuredClone(v);

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

export function buildDonor(overrides: Partial<Donor> = {}): Donor {
  return {
    id: randomUUID(),
    name: 'ADRA',
    shortName: 'ADRA',
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    notes: null,
    isActive: true,
    ...overrides,
  };
}

export function buildGrant(overrides: Partial<Grant> = {}): Grant {
  return {
    id: randomUUID(),
    donorId: randomUUID(),
    code: 'ADRA-2026-01',
    name: 'Madani WASH response',
    currency: 'USD',
    totalAmount: '50000.00',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    status: 'active',
    version: 1,
    officeIds: [MAD_OFFICE_ID],
    ...overrides,
  };
}

export function buildLine(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    id: randomUUID(),
    grantId: randomUUID(),
    code: '10202',
    description: 'Hygiene kits',
    category: 'supplies',
    budgetAmount: '10000.00',
    officeId: null,
    isActive: true,
    version: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// Donors
// ---------------------------------------------------------------------------------------------

export class FakeDonorStore implements DonorStore {
  readonly rows = new Map<string, Donor>();

  seed(...donors: Donor[]): this {
    for (const d of donors) this.rows.set(d.id, clone(d));
    return this;
  }

  async list(filter: { isActive?: boolean }, pagination: Pagination) {
    const items = [...this.rows.values()]
      .filter((d) => filter.isActive === undefined || d.isActive === filter.isActive)
      .sort((a, b) => a.name.localeCompare(b.name));
    return paginate(items.map(clone), pagination);
  }

  async findById(id: string) {
    const d = this.rows.get(id);
    return d ? clone(d) : null;
  }

  async findByName(name: string) {
    const key = name.trim().toLowerCase();
    const d = [...this.rows.values()].find((r) => r.name.toLowerCase() === key);
    return d ? clone(d) : null;
  }

  async insert(values: DonorValues) {
    const donor = { ...values, id: randomUUID() };
    this.rows.set(donor.id, clone(donor));
    return clone(donor);
  }

  async update(id: string, values: Partial<DonorValues>) {
    const current = this.rows.get(id);
    if (!current) throw new AppError('NOT_FOUND', 'donor not found');
    const defined = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
    const next = { ...current, ...defined };
    this.rows.set(id, next);
    return clone(next);
  }
}

// ---------------------------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------------------------

export class FakeGrantStore implements GrantStore {
  readonly rows = new Map<string, Grant>();
  readonly pending = new Map<string, number>();
  readonly withCommitments = new Set<string>();
  readonly lineTotals = new Map<string, string>();

  seed(...grants: Grant[]): this {
    for (const g of grants) this.rows.set(g.id, clone(g));
    return this;
  }

  async search(filter: GrantFilter, pagination: Pagination) {
    const items = [...this.rows.values()]
      .filter((g) => !filter.status || g.status === filter.status)
      .filter((g) => !filter.donorId || g.donorId === filter.donorId)
      .filter((g) => !filter.officeId || g.officeIds.includes(filter.officeId))
      .filter(
        (g) =>
          !filter.coversDate || (g.startDate <= filter.coversDate && g.endDate >= filter.coversDate)
      )
      .sort((a, b) => a.code.localeCompare(b.code));
    return paginate(items.map(clone), pagination);
  }

  async findById(id: string) {
    const g = this.rows.get(id);
    return g ? clone(g) : null;
  }

  async findByCode(code: string) {
    const g = [...this.rows.values()].find((r) => r.code === code);
    return g ? clone(g) : null;
  }

  async insert(values: GrantValues) {
    const grant: Grant = {
      status: 'active',
      ...values,
      id: randomUUID(),
      version: 1,
      officeIds: [],
    };
    this.rows.set(grant.id, clone(grant));
    return clone(grant);
  }

  async update(id: string, values: Partial<GrantValues>, expectedVersion?: number) {
    const current = this.rows.get(id);
    if (!current) throw new AppError('NOT_FOUND', 'grant not found');
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
    const next = { ...current, ...values, version: current.version + 1 };
    this.rows.set(id, next);
    return clone(next);
  }

  async setOffices(grantId: string, officeIds: readonly string[]) {
    const g = this.rows.get(grantId);
    if (g) g.officeIds = [...officeIds].sort();
  }

  async budgetLinesTotal(grantId: string) {
    return this.lineTotals.get(grantId) ?? '0.00';
  }

  async pendingPrCount(grantId: string) {
    return this.pending.get(grantId) ?? 0;
  }

  async hasCommitments(grantId: string) {
    return this.withCommitments.has(grantId);
  }
}

// ---------------------------------------------------------------------------------------------
// Budget lines + commitment ledger (one object implements both ports, sharing state)
// ---------------------------------------------------------------------------------------------

export interface FakeCommitment extends CommitmentRow {
  releaseReason: string | null;
}

export class FakeBudgetLedger implements BudgetLineStore, BudgetTxStore {
  readonly lines = new Map<string, BudgetLine>();
  readonly commitments: FakeCommitment[] = [];
  /** grantId → currency, for lockLines */
  readonly currencies = new Map<string, string>();
  /** every lockLines call, to assert ordering */
  readonly lockCalls: string[][] = [];

  seedLines(...lines: BudgetLine[]): this {
    for (const l of lines) this.lines.set(l.id, clone(l));
    return this;
  }

  /** An open hold of some PR on a line. */
  hold(
    budgetLineId: string,
    amount: string,
    status: 'reserved' | 'committed' = 'reserved',
    prId: string = randomUUID(),
    cycle = 1
  ): FakeCommitment {
    const row: FakeCommitment = {
      id: randomUUID(),
      prId,
      budgetLineId,
      cycle,
      amount,
      status,
      releaseReason: null,
    };
    this.commitments.push(row);
    return row;
  }

  private sumUsage(ids: readonly string[], excludePrId?: string): Map<string, BudgetUsage> {
    const usage = new Map<string, BudgetUsage>();
    for (const id of ids) {
      let reserved = new Decimal(0);
      let committed = new Decimal(0);
      let any = false;
      for (const c of this.commitments) {
        if (c.budgetLineId !== id || c.status === 'released' || c.prId === excludePrId) continue;
        any = true;
        if (c.status === 'reserved') reserved = reserved.plus(c.amount);
        else committed = committed.plus(c.amount);
      }
      if (any) usage.set(id, { reserved: reserved.toFixed(2), committed: committed.toFixed(2) });
    }
    return usage;
  }

  // BudgetLineStore
  async listByGrant(grantId: string) {
    return [...this.lines.values()]
      .filter((l) => l.grantId === grantId)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(clone);
  }

  async findById(id: string) {
    const l = this.lines.get(id);
    return l ? clone(l) : null;
  }

  async findByCode(grantId: string, code: string) {
    const l = [...this.lines.values()].find((r) => r.grantId === grantId && r.code === code);
    return l ? clone(l) : null;
  }

  async insert(values: BudgetLineValues) {
    const line: BudgetLine = { isActive: true, ...values, id: randomUUID(), version: 1 };
    this.lines.set(line.id, clone(line));
    return clone(line);
  }

  async insertMany(rows: BudgetLineValues[]) {
    for (const r of rows) await this.insert(r);
    return rows.length;
  }

  async update(id: string, values: Partial<BudgetLineValues>, expectedVersion: number) {
    const current = this.lines.get(id);
    if (!current) throw new AppError('NOT_FOUND', 'budget_line not found');
    if (current.version !== expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
    const defined = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
    const next = { ...current, ...defined, version: current.version + 1 };
    this.lines.set(id, next);
    return clone(next);
  }

  async usageByGrant(grantId: string) {
    const ids = [...this.lines.values()].filter((l) => l.grantId === grantId).map((l) => l.id);
    return this.sumUsage(ids);
  }

  // BudgetTxStore
  async lockLines(_tx: TenantTx, ids: readonly string[]) {
    const sorted = [...new Set(ids)].sort();
    this.lockCalls.push(sorted);
    return sorted
      .map((id) => this.lines.get(id))
      .filter((l): l is BudgetLine => l !== undefined)
      .map((l) => ({
        id: l.id,
        grantId: l.grantId,
        code: l.code,
        budgetAmount: l.budgetAmount,
        currency: this.currencies.get(l.grantId) ?? 'USD',
        version: l.version,
      }));
  }

  async usage(_tx: TenantTx, ids: readonly string[], options: { excludePrId?: string } = {}) {
    return this.sumUsage(ids, options.excludePrId);
  }

  async updateLine(
    _tx: TenantTx,
    id: string,
    values: Partial<BudgetLineValues>,
    expectedVersion: number
  ) {
    return this.update(id, values, expectedVersion);
  }

  async listCommitments(_tx: TenantTx, prId: string) {
    return this.commitments.filter((c) => c.prId === prId).map(clone);
  }

  async insertCommitment(_tx: TenantTx, row: Omit<CommitmentRow, 'id' | 'status'>) {
    const exists = this.commitments.some(
      (c) => c.prId === row.prId && c.budgetLineId === row.budgetLineId && c.cycle === row.cycle
    );
    if (exists) throw new AppError('VALIDATION_ERROR', 'duplicate commitment');
    return clone(this.hold(row.budgetLineId, row.amount, 'reserved', row.prId, row.cycle));
  }

  async updateCommitment(_tx: TenantTx, id: string, patch: CommitmentPatch) {
    const c = this.commitments.find((r) => r.id === id);
    if (!c) throw new AppError('NOT_FOUND', 'budget_commitment not found');
    if (patch.amount !== undefined) c.amount = patch.amount;
    if (patch.status !== undefined) {
      c.status = patch.status;
      c.releaseReason = patch.status === 'released' ? (patch.releaseReason ?? null) : null;
    }
    return clone(c);
  }
}

// ---------------------------------------------------------------------------------------------
// Exchange rates
// ---------------------------------------------------------------------------------------------

export class FakeRateStore implements ExchangeRateStore {
  readonly rows: RateRow[] = [];
  readonly inUse = new Set<string>();
  base = 'SDG';
  private clock = 0;

  /** Adds a rate; later calls get a later created_at. */
  add(values: Partial<RateValues> & { inUse?: boolean } = {}): RateRow {
    const { inUse, ...rest } = values;
    const row: RateRow = {
      id: randomUUID(),
      currency: 'USD',
      rateToBase: '600',
      rateDate: '2026-11-01',
      source: 'Central Bank of Sudan',
      createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, this.clock++)).toISOString(),
      ...rest,
    };
    this.rows.push(row);
    if (inUse) this.inUse.add(row.id);
    return clone(row);
  }

  async list(filter: RateFilter, pagination: Pagination) {
    const items = this.rows
      .filter((r) => !filter.currency || r.currency === filter.currency)
      .filter((r) => !filter.from || r.rateDate >= filter.from)
      .filter((r) => !filter.to || r.rateDate <= filter.to)
      .sort((a, b) =>
        a.rateDate === b.rateDate
          ? b.createdAt.localeCompare(a.createdAt)
          : b.rateDate.localeCompare(a.rateDate)
      );
    return paginate(items.map(clone), pagination);
  }

  async findById(id: string) {
    const r = this.rows.find((x) => x.id === id);
    return r ? clone(r) : null;
  }

  async insert(values: RateValues) {
    return this.add(values);
  }

  async update(id: string, values: Partial<RateValues>) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) throw new AppError('NOT_FOUND', 'exchange_rate not found');
    Object.assign(r, Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)));
    return clone(r);
  }

  async delete(id: string) {
    const index = this.rows.findIndex((x) => x.id === id);
    if (index === -1) throw new AppError('NOT_FOUND', 'exchange_rate not found');
    this.rows.splice(index, 1);
  }

  async latestOnOrBefore(currency: string, date: string) {
    const [latest] = this.rows
      .filter((r) => r.currency === currency && r.rateDate <= date)
      .sort((a, b) =>
        a.rateDate === b.rateDate
          ? b.createdAt.localeCompare(a.createdAt)
          : b.rateDate.localeCompare(a.rateDate)
      );
    return latest ? clone(latest) : null;
  }

  async inUseIds(ids: readonly string[]) {
    return new Set(ids.filter((id) => this.inUse.has(id)));
  }

  async baseCurrency() {
    return this.base;
  }
}

// ---------------------------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------------------------

export class FakeActivityStore implements ActivityStore {
  readonly rows = new Map<string, Activity>();

  async listByGrant(grantId: string) {
    return [...this.rows.values()].filter((a) => a.grantId === grantId).map(clone);
  }

  async findById(id: string) {
    const a = this.rows.get(id);
    return a ? clone(a) : null;
  }

  async findByCode(grantId: string, code: string) {
    const a = [...this.rows.values()].find((r) => r.grantId === grantId && r.code === code);
    return a ? clone(a) : null;
  }

  async insert(values: ActivityValues) {
    const activity = { ...values, id: randomUUID() };
    this.rows.set(activity.id, clone(activity));
    return clone(activity);
  }

  async update(id: string, values: Partial<ActivityValues>) {
    const current = this.rows.get(id);
    if (!current) throw new AppError('NOT_FOUND', 'activity not found');
    const next = { ...current, ...values };
    this.rows.set(id, next);
    return clone(next);
  }
}
