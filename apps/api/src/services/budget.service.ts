// Budget lines and their derived figures (FR-012–FR-014, research R5), plus the commitment
// primitives the PR workflow uses inside its transaction (US4–US6): check availability, reserve,
// commit, release and move a reservation. Available = Budget − Reserved − Committed − Actual;
// Actual is 0 until the Payments feature.
import {
  Decimal,
  parseAmount,
  type BudgetFigures,
  type BudgetLine,
  type BudgetLineCreate,
  type BudgetLineListResponse,
  type BudgetLineUpdate,
  type BudgetLineWithBalance,
  type BudgetShortfallLine,
  type Grant,
} from '@ngo/shared';
import { withTenantTx, type TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import {
  BudgetLineRepository,
  BudgetTxRepository,
  type BudgetLineStore,
  type BudgetTxStore,
  type BudgetUsage,
  type CommitmentRow,
  type LockedBudgetLine,
  type ReleaseReason,
} from '../repositories/budget-line.repository';
import { GrantRepository } from '../repositories/grant.repository';
import type { RequestContext } from '../types/context';

export interface BudgetDeps {
  grants: { findById(id: string): Promise<Grant | null> };
  lines: BudgetLineStore;
  txStore: BudgetTxStore;
  /** Opens the tenant transaction (withTenantTx) for amount edits. */
  runTx<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T>;
}

/** Amount to hold on one budget line, in the grant currency. */
export interface LineAmount {
  budgetLineId: string;
  amount: string;
  /** PR lines charged to this budget line, echoed in BUDGET_EXCEEDED details */
  prLineIds?: string[];
}

export interface AvailabilityLine {
  budgetLineId: string;
  code: string;
  currency: string;
  requested: string;
  available: string;
}

export interface AvailabilityResult {
  ok: boolean;
  lines: AvailabilityLine[];
  shortfalls: BudgetShortfallLine[];
}

const ZERO_USAGE: BudgetUsage = { reserved: '0', committed: '0' };
const fixed2 = (d: Decimal) => d.toFixed(2);

/** Budget, Reserved, Committed, Actual → Available and % used, all derived (FR-012). */
export function deriveFigures(
  budget: string,
  usage: BudgetUsage = ZERO_USAGE,
  actual = '0'
): BudgetFigures {
  const b = parseAmount(budget);
  const used = parseAmount(usage.reserved).plus(usage.committed).plus(actual);
  return {
    budget: fixed2(b),
    reserved: fixed2(parseAmount(usage.reserved)),
    committed: fixed2(parseAmount(usage.committed)),
    actual: fixed2(parseAmount(actual)),
    available: fixed2(b.minus(used)),
    pctUsed: b.isZero() ? null : used.dividedBy(b).times(100).toFixed(2),
  };
}

/** Sums amounts per budget line, keeping first-seen order and the PR line ids. */
function aggregate(amounts: readonly LineAmount[]): LineAmount[] {
  const byLine = new Map<string, { amount: Decimal; prLineIds: string[] }>();
  for (const a of amounts) {
    const current = byLine.get(a.budgetLineId) ?? { amount: new Decimal(0), prLineIds: [] };
    current.amount = current.amount.plus(parseAmount(a.amount));
    current.prLineIds.push(...(a.prLineIds ?? []));
    byLine.set(a.budgetLineId, current);
  }
  return [...byLine.entries()].map(([budgetLineId, v]) => ({
    budgetLineId,
    amount: fixed2(v.amount),
    prLineIds: v.prLineIds,
  }));
}

export class BudgetService {
  constructor(private readonly deps: BudgetDeps) {}

  static forContext(ctx: RequestContext): BudgetService {
    return new BudgetService({
      grants: new GrantRepository(ctx),
      lines: new BudgetLineRepository(ctx),
      txStore: new BudgetTxRepository(ctx),
      runTx: (fn) => withTenantTx(ctx, fn),
    });
  }

  // -------------------------------------------------------------------------------------------
  // Budget lines
  // -------------------------------------------------------------------------------------------

  /** GET /grants/:id/budget-lines — every line with its figures, plus grant totals (FR-013). */
  async list(grantId: string): Promise<BudgetLineListResponse> {
    const grant = await this.getGrant(grantId);
    const [lines, usage] = await Promise.all([
      this.deps.lines.listByGrant(grantId),
      this.deps.lines.usageByGrant(grantId),
    ]);
    const data: BudgetLineWithBalance[] = lines.map((line) => ({
      ...line,
      ...deriveFigures(line.budgetAmount, usage.get(line.id)),
      currency: grant.currency,
    }));

    const sum = (pick: (l: BudgetLineWithBalance) => string) =>
      data.reduce((acc, l) => acc.plus(pick(l)), new Decimal(0));
    const budgetLinesTotal = sum((l) => l.budget);
    const difference = parseAmount(grant.totalAmount).minus(budgetLinesTotal);

    return {
      data,
      page: 1,
      pageSize: data.length,
      total: data.length,
      summary: {
        currency: grant.currency,
        totalAmount: fixed2(parseAmount(grant.totalAmount)),
        budgetLinesTotal: fixed2(budgetLinesTotal),
        difference: fixed2(difference),
        hasDifference: !difference.isZero(),
        totals: deriveFigures(fixed2(budgetLinesTotal), {
          reserved: fixed2(sum((l) => l.reserved)),
          committed: fixed2(sum((l) => l.committed)),
        }),
      },
    };
  }

  async get(id: string): Promise<BudgetLineWithBalance> {
    const line = await this.getLine(id);
    const [grant, usage] = await Promise.all([
      this.getGrant(line.grantId),
      this.deps.lines.usageByGrant(line.grantId),
    ]);
    return {
      ...line,
      ...deriveFigures(line.budgetAmount, usage.get(id)),
      currency: grant.currency,
    };
  }

  async create(grantId: string, input: BudgetLineCreate): Promise<BudgetLine> {
    await this.getGrant(grantId);
    await this.assertCodeFree(grantId, input.code);
    return this.deps.lines.insert({
      grantId,
      code: input.code,
      description: input.description,
      category: input.category,
      budgetAmount: input.budgetAmount,
      officeId: input.officeId ?? null,
    });
  }

  /**
   * PATCH /budget-lines/:id. An amount change runs in the tenant transaction with the line
   * locked, so no reservation can slip in between the check and the write (FR-014).
   */
  async update(id: string, input: BudgetLineUpdate): Promise<BudgetLine> {
    const { expectedVersion, ...values } = input;
    const current = await this.getLine(id);
    if (values.code !== undefined && values.code !== current.code) {
      await this.assertCodeFree(current.grantId, values.code, id);
    }

    if (values.budgetAmount === undefined) {
      return this.deps.lines.update(id, values, expectedVersion);
    }

    const newAmount = values.budgetAmount;
    return this.deps.runTx(async (tx) => {
      const [locked] = await this.deps.txStore.lockLines(tx, [id]);
      if (!locked) throw new AppError('NOT_FOUND', 'budget_line not found');
      if (locked.version !== expectedVersion) {
        throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
      }
      const usage = (await this.deps.txStore.usage(tx, [id])).get(id) ?? ZERO_USAGE;
      const actual = '0';
      const minimum = parseAmount(usage.reserved).plus(usage.committed).plus(actual);
      if (parseAmount(newAmount).lessThan(minimum)) {
        throw new AppError(
          'BUDGET_BELOW_USAGE',
          'The budget cannot be reduced below reserved + committed + actual',
          { minimum: fixed2(minimum) }
        );
      }
      return this.deps.txStore.updateLine(tx, id, values, expectedVersion);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Commitment primitives — called inside the PR command's transaction
  // -------------------------------------------------------------------------------------------

  /**
   * Locks the lines (ascending id) and compares each requested amount with Available. With
   * `excludePrId`, that PR's own open holds do not count as used (finance-check re-checks).
   */
  async checkAvailability(
    tx: TenantTx,
    amounts: readonly LineAmount[],
    options: { excludePrId?: string } = {}
  ): Promise<AvailabilityResult> {
    const wanted = aggregate(amounts);
    const ids = wanted.map((w) => w.budgetLineId);
    const locked = new Map(
      (await this.deps.txStore.lockLines(tx, ids)).map((l): [string, LockedBudgetLine] => [l.id, l])
    );
    const missing = ids.filter((id) => !locked.has(id));
    if (missing.length) throw new AppError('NOT_FOUND', `budget_line not found: ${missing[0]}`);

    const usage = await this.deps.txStore.usage(tx, ids, options);
    const lines: AvailabilityLine[] = [];
    const shortfalls: BudgetShortfallLine[] = [];
    for (const w of wanted) {
      const line = locked.get(w.budgetLineId)!;
      const available = parseAmount(deriveFigures(line.budgetAmount, usage.get(line.id)).available);
      const requested = parseAmount(w.amount);
      lines.push({
        budgetLineId: line.id,
        code: line.code,
        currency: line.currency,
        requested: fixed2(requested),
        available: fixed2(available),
      });
      if (requested.greaterThan(available)) {
        shortfalls.push({
          budgetLineId: line.id,
          code: line.code,
          requested: fixed2(requested),
          available: fixed2(available),
          shortfall: fixed2(requested.minus(available)),
          currency: line.currency,
          prLineIds: w.prLineIds ?? [],
        });
      }
    }
    return { ok: shortfalls.length === 0, lines, shortfalls };
  }

  /** Holds the amounts for one submission cycle, or 422 BUDGET_EXCEEDED per short line. */
  async reserve(
    tx: TenantTx,
    prId: string,
    cycle: number,
    amounts: readonly LineAmount[]
  ): Promise<CommitmentRow[]> {
    const check = await this.checkAvailability(tx, amounts, { excludePrId: prId });
    if (!check.ok) {
      throw new AppError('BUDGET_EXCEEDED', 'The amount exceeds the available budget', {
        lines: check.shortfalls,
      });
    }
    const existing = await this.deps.txStore.listCommitments(tx, prId);
    if (existing.some((c) => c.status !== 'released')) {
      throw new AppError('INVALID_STATE', 'The requisition already holds budget');
    }

    const rows: CommitmentRow[] = [];
    for (const line of check.lines) {
      if (parseAmount(line.requested).isZero()) continue;
      const prior = existing.find((c) => c.budgetLineId === line.budgetLineId && c.cycle === cycle);
      rows.push(
        prior
          ? await this.deps.txStore.updateCommitment(tx, prior.id, {
              amount: line.requested,
              status: 'reserved',
            })
          : await this.deps.txStore.insertCommitment(tx, {
              prId,
              budgetLineId: line.budgetLineId,
              cycle,
              amount: line.requested,
            })
      );
    }
    return rows;
  }

  /** Final approval: Reserved → Committed for the cycle (FR-036). */
  async commit(tx: TenantTx, prId: string, cycle: number): Promise<CommitmentRow[]> {
    const open = (await this.deps.txStore.listCommitments(tx, prId)).filter(
      (c) => c.cycle === cycle && c.status === 'reserved'
    );
    const rows: CommitmentRow[] = [];
    for (const c of open) {
      rows.push(await this.deps.txStore.updateCommitment(tx, c.id, { status: 'committed' }));
    }
    return rows;
  }

  /** Return, reject or cancel: every open hold of the PR is released (kept for audit). */
  async release(tx: TenantTx, prId: string, reason: ReleaseReason): Promise<CommitmentRow[]> {
    const open = (await this.deps.txStore.listCommitments(tx, prId)).filter(
      (c) => c.status !== 'released'
    );
    const rows: CommitmentRow[] = [];
    for (const c of open) {
      rows.push(
        await this.deps.txStore.updateCommitment(tx, c.id, {
          status: 'released',
          releaseReason: reason,
        })
      );
    }
    return rows;
  }

  /**
   * Finance check changes a PR line's budget line: `amount` moves from one reservation to the
   * other after re-checking the target (the PR's own holds there count as requested).
   */
  async moveReservation(
    tx: TenantTx,
    prId: string,
    cycle: number,
    fromLineId: string,
    toLineId: string,
    amount: string
  ): Promise<CommitmentRow[]> {
    if (fromLineId === toLineId || parseAmount(amount).isZero()) return [];
    const commitments = (await this.deps.txStore.listCommitments(tx, prId)).filter(
      (c) => c.cycle === cycle
    );
    const from = commitments.find((c) => c.budgetLineId === fromLineId && c.status === 'reserved');
    if (!from || parseAmount(from.amount).lessThan(amount)) {
      throw new AppError('INVALID_STATE', 'No matching reservation to move');
    }
    const to = commitments.find((c) => c.budgetLineId === toLineId);
    const ownOnTarget = to && to.status === 'reserved' ? to.amount : '0';

    // both lines, in the same ascending order as every other command (no deadlocks)
    await this.deps.txStore.lockLines(tx, [fromLineId, toLineId]);
    const check = await this.checkAvailability(
      tx,
      [{ budgetLineId: toLineId, amount: fixed2(parseAmount(ownOnTarget).plus(amount)) }],
      { excludePrId: prId }
    );
    if (!check.ok) {
      throw new AppError('BUDGET_EXCEEDED', 'The amount exceeds the available budget', {
        lines: check.shortfalls,
      });
    }

    const remaining = parseAmount(from.amount).minus(amount);
    const moved = remaining.isZero()
      ? await this.deps.txStore.updateCommitment(tx, from.id, {
          status: 'released',
          releaseReason: 'budget_line_changed',
        })
      : await this.deps.txStore.updateCommitment(tx, from.id, { amount: fixed2(remaining) });

    const target = !to
      ? await this.deps.txStore.insertCommitment(tx, {
          prId,
          budgetLineId: toLineId,
          cycle,
          amount: fixed2(parseAmount(amount)),
        })
      : await this.deps.txStore.updateCommitment(tx, to.id, {
          amount: fixed2(parseAmount(ownOnTarget).plus(amount)),
          status: 'reserved',
        });
    return [moved, target];
  }

  // -------------------------------------------------------------------------------------------

  private async getGrant(id: string): Promise<Grant> {
    const grant = await this.deps.grants.findById(id);
    if (!grant) throw new AppError('NOT_FOUND', 'grant not found');
    return grant;
  }

  private async getLine(id: string): Promise<BudgetLine> {
    const line = await this.deps.lines.findById(id);
    if (!line) throw new AppError('NOT_FOUND', 'budget_line not found');
    return line;
  }

  private async assertCodeFree(grantId: string, code: string, exceptId?: string) {
    const existing = await this.deps.lines.findByCode(grantId, code);
    if (existing && existing.id !== exceptId) {
      throw new AppError('VALIDATION_ERROR', 'A budget line with this code already exists', [
        { field: 'code', message: 'already_exists' },
      ]);
    }
  }
}
