// T115 — the finance checker moves a PR line to another budget line of the same grant during the
// finance check; the reservation follows after the target is re-checked without this PR's own
// holds (US5-4, FR-033).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/middleware/error';
import { buildLine } from './helpers/funding-fakes';
import { buildPrWorld, type PrWorld } from './helpers/pr-fakes';

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected the command to fail');
}

function addBudgetLine(w: PrWorld, budgetAmount: string, grantId = w.grantId) {
  const line = buildLine({ grantId, code: `B-${randomUUID().slice(0, 4)}`, budgetAmount });
  w.ledger.seedLines(line);
  w.db.budgetLines.set(line.id, grantId);
  return line;
}

async function setup(w: PrWorld) {
  const pr = await w.seedSubmitted(); // one line, 1,451.18 USD reserved on 10202
  const [line] = await w.db.lines(pr.id);
  const move = async (budgetLineId: string, userId = w.financeUserId) => {
    const current = (await w.db.find(pr.id))!;
    return w.as(userId).changeBudgetLine(pr.id, line!.id, {
      expectedVersion: current.version,
      budgetLineId,
      comment: 'Charge to supplies',
    });
  };
  return { pr, line: line!, move };
}

describe('PR change budget line', () => {
  it('moves the line and its reservation, and logs the change (FR-033)', async () => {
    const w = buildPrWorld();
    const target = addBudgetLine(w, '5000.00');
    const { pr, line, move } = await setup(w);

    const result = await move(target.id);
    expect(result).toMatchObject({ status: 'pending_finance_check', version: pr.version + 1 });
    expect((await w.db.lines(pr.id))[0]!.budgetLineId).toBe(target.id);
    expect(w.ledger.commitments).toEqual([
      expect.objectContaining({
        budgetLineId: w.budgetLineId,
        status: 'released',
        releaseReason: 'budget_line_changed',
      }),
      expect.objectContaining({
        budgetLineId: target.id,
        cycle: 1,
        amount: '1451.18',
        status: 'reserved',
      }),
    ]);
    expect(w.actions.rows.at(-1)).toMatchObject({
      action: 'change_budget_line',
      stepOrder: 1,
      comment: 'Charge to supplies',
      payload: { lineId: line.id, fromBudgetLineId: w.budgetLineId, toBudgetLineId: target.id },
    });
  });

  it('insufficient budget on the target → BUDGET_EXCEEDED with the shortfall (US5-4)', async () => {
    const w = buildPrWorld();
    const target = addBudgetLine(w, '1000.00');
    const { move } = await setup(w);
    const err = await failure(move(target.id));
    expect(err.code).toBe('BUDGET_EXCEEDED');
    expect(err.details).toEqual({
      lines: [
        expect.objectContaining({
          budgetLineId: target.id,
          requested: '1451.18',
          available: '1000.00',
          shortfall: '451.18',
        }),
      ],
    });
    // nothing moved
    expect(w.ledger.commitments).toEqual([
      expect.objectContaining({ budgetLineId: w.budgetLineId, status: 'reserved' }),
    ]);
  });

  it("the target's availability does not count this PR's own reservation", async () => {
    const w = buildPrWorld();
    const { pr, move } = await setup(w);
    // a second line of this PR already reserved on the target, exactly filling what is left
    const target = addBudgetLine(w, '1500.00');
    w.ledger.hold(target.id, '48.82', 'reserved', pr.id, 1);
    await expect(move(target.id)).resolves.toMatchObject({ status: 'pending_finance_check' });
    expect(
      w.ledger.commitments.find((c) => c.budgetLineId === target.id && c.status === 'reserved')
        ?.amount
    ).toBe('1500.00');
  });

  it('the target must belong to the PR grant → PR_LINE_GRANT_MISMATCH', async () => {
    const w = buildPrWorld();
    const other = addBudgetLine(w, '5000.00', randomUUID());
    const { move } = await setup(w);
    const err = await failure(move(other.id));
    expect(err.code).toBe('PR_LINE_GRANT_MISMATCH');
  });

  it('only an eligible finance checker → FORBIDDEN for others, SEGREGATION for the requester', async () => {
    const w = buildPrWorld();
    const target = addBudgetLine(w, '5000.00');
    const { move } = await setup(w);
    expect((await failure(move(target.id, w.approverUserId))).code).toBe('FORBIDDEN');
    expect((await failure(move(target.id, w.requesterId))).code).toBe('SEGREGATION_OF_DUTIES');
  });

  it('only while pending_finance_check → INVALID_STATE after the finance check', async () => {
    const w = buildPrWorld();
    const target = addBudgetLine(w, '5000.00');
    const { pr, move } = await setup(w);
    const { step } = await w.current(pr.id);
    await w.as(w.financeUserId).approve(pr.id, { expectedVersion: pr.version, stepId: step!.id });
    const err = await failure(move(target.id));
    expect(err.code).toBe('INVALID_STATE');
  });
});
