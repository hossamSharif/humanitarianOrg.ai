// T065 — budget figures (FR-012), reducing a budget below usage (FR-014, US2-6), the grant-total
// difference warning (FR-013, US2-4), and the commitment primitives used by US4–US6.
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/middleware/error';
import { BudgetService, deriveFigures } from '../../src/services/budget.service';
import {
  FAKE_TX,
  FakeBudgetLedger,
  FakeGrantStore,
  buildGrant,
  buildLine,
  runFakeTx,
} from './helpers/funding-fakes';

let grants: FakeGrantStore;
let ledger: FakeBudgetLedger;
let service: BudgetService;
const grant = buildGrant({ totalAmount: '50000.00', currency: 'USD' });

beforeEach(() => {
  grants = new FakeGrantStore().seed(grant);
  ledger = new FakeBudgetLedger();
  ledger.currencies.set(grant.id, 'USD');
  service = new BudgetService({ grants, lines: ledger, txStore: ledger, runTx: runFakeTx });
});

async function expectAppError(promise: Promise<unknown>, code: string): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

describe('deriveFigures (FR-012)', () => {
  it('Available = Budget − Reserved − Committed − Actual, with Actual = 0', () => {
    expect(deriveFigures('10000', { reserved: '2500.50', committed: '1500' })).toEqual({
      budget: '10000.00',
      reserved: '2500.50',
      committed: '1500.00',
      actual: '0.00',
      available: '5999.50',
      pctUsed: '40.01',
    });
  });

  it('no usage → everything available; zero budget → pctUsed null', () => {
    expect(deriveFigures('750.00')).toMatchObject({ available: '750.00', pctUsed: '0.00' });
    expect(deriveFigures('0')).toMatchObject({ available: '0.00', pctUsed: null });
  });

  it('decimal arithmetic, never floating point', () => {
    expect(deriveFigures('0.30', { reserved: '0.10', committed: '0.20' }).available).toBe('0.00');
  });
});

describe('list balances and grant summary', () => {
  it('derives each line from its open holds; released holds do not count', async () => {
    const line = buildLine({ grantId: grant.id, budgetAmount: '10000.00' });
    ledger.seedLines(line);
    ledger.hold(line.id, '3000.00', 'reserved');
    ledger.hold(line.id, '1000.00', 'committed');
    ledger.hold(line.id, '999.00', 'reserved').status = 'released';

    const { data } = await service.list(grant.id);
    expect(data[0]).toMatchObject({
      code: '10202',
      currency: 'USD',
      budget: '10000.00',
      reserved: '3000.00',
      committed: '1000.00',
      actual: '0.00',
      available: '6000.00',
      pctUsed: '40.00',
    });
  });

  it('budget lines total ≠ grant total → warning flag with the difference, not an error', async () => {
    ledger.seedLines(
      buildLine({ grantId: grant.id, code: '10202', budgetAmount: '30000.00' }),
      buildLine({ grantId: grant.id, code: '2.2.31', budgetAmount: '15000.00' })
    );
    const { summary } = await service.list(grant.id);
    expect(summary).toMatchObject({
      currency: 'USD',
      totalAmount: '50000.00',
      budgetLinesTotal: '45000.00',
      difference: '5000.00',
      hasDifference: true,
    });
  });

  it('matching totals → no warning', async () => {
    ledger.seedLines(buildLine({ grantId: grant.id, budgetAmount: '50000.00' }));
    expect((await service.list(grant.id)).summary.hasDifference).toBe(false);
  });

  it('unknown grant → NOT_FOUND', async () => {
    await expectAppError(service.list(randomUUID()), 'NOT_FOUND');
  });
});

describe('budget line create / update', () => {
  it('creates a line keeping the donor code as entered', async () => {
    const line = await service.create(grant.id, {
      code: '2.2.31',
      description: 'Training',
      category: 'services',
      budgetAmount: '1200.00',
    });
    expect(line).toMatchObject({ code: '2.2.31', officeId: null, grantId: grant.id });
  });

  it('duplicate code in the grant → VALIDATION_ERROR on code', async () => {
    ledger.seedLines(buildLine({ grantId: grant.id, code: '10202' }));
    const error = await expectAppError(
      service.create(grant.id, {
        code: '10202',
        description: 'x',
        category: 'supplies',
        budgetAmount: '1',
      }),
      'VALIDATION_ERROR'
    );
    expect(error.details).toEqual([{ field: 'code', message: 'already_exists' }]);
  });

  it('reducing below reserved + committed + actual → BUDGET_BELOW_USAGE with the minimum (US2-6)', async () => {
    const line = buildLine({ grantId: grant.id, budgetAmount: '10000.00' });
    ledger.seedLines(line);
    ledger.hold(line.id, '2500.00', 'reserved');
    ledger.hold(line.id, '1500.00', 'committed');

    const error = await expectAppError(
      service.update(line.id, { budgetAmount: '3000.00', expectedVersion: 1 }),
      'BUDGET_BELOW_USAGE'
    );
    expect(error.details).toEqual({ minimum: '4000.00' });
    expect(ledger.lines.get(line.id)!.budgetAmount).toBe('10000.00');
    expect(ledger.lockCalls).toEqual([[line.id]]);
  });

  it('reducing exactly to usage is allowed and bumps the version', async () => {
    const line = buildLine({ grantId: grant.id, budgetAmount: '10000.00' });
    ledger.seedLines(line);
    ledger.hold(line.id, '4000.00', 'reserved');
    const updated = await service.update(line.id, { budgetAmount: '4000.00', expectedVersion: 1 });
    expect(updated).toMatchObject({ budgetAmount: '4000.00', version: 2 });
  });

  it('stale version → VERSION_CONFLICT (amount and plain edits)', async () => {
    const line = buildLine({ grantId: grant.id, version: 3 });
    ledger.seedLines(line);
    await expectAppError(
      service.update(line.id, { budgetAmount: '1.00', expectedVersion: 2 }),
      'VERSION_CONFLICT'
    );
    await expectAppError(
      service.update(line.id, { description: 'x', expectedVersion: 2 }),
      'VERSION_CONFLICT'
    );
  });
});

describe('commitment primitives', () => {
  const prId = randomUUID();

  function twoLines() {
    const a = buildLine({ grantId: grant.id, code: '10202', budgetAmount: '1000.00' });
    const b = buildLine({ grantId: grant.id, code: '10203', budgetAmount: '500.00' });
    ledger.seedLines(a, b);
    return { a, b };
  }

  it('checkAvailability aggregates per line and reports each shortfall', async () => {
    const { a, b } = twoLines();
    ledger.hold(b.id, '400.00');
    const result = await service.checkAvailability(FAKE_TX, [
      { budgetLineId: a.id, amount: '600.00', prLineIds: ['l1'] },
      { budgetLineId: a.id, amount: '300.00', prLineIds: ['l2'] },
      { budgetLineId: b.id, amount: '150.00', prLineIds: ['l3'] },
    ]);
    expect(result.ok).toBe(false);
    expect(result.shortfalls).toEqual([
      {
        budgetLineId: b.id,
        code: '10203',
        requested: '150.00',
        available: '100.00',
        shortfall: '50.00',
        currency: 'USD',
        prLineIds: ['l3'],
      },
    ]);
    expect(ledger.lockCalls[0]).toEqual([a.id, b.id].sort());
  });

  it('reserve → commit → release moves holds through the states', async () => {
    const { a } = twoLines();
    await service.reserve(FAKE_TX, prId, 1, [{ budgetLineId: a.id, amount: '700.00' }]);
    expect((await service.list(grant.id)).data.find((l) => l.id === a.id)).toMatchObject({
      reserved: '700.00',
      available: '300.00',
    });

    await service.commit(FAKE_TX, prId, 1);
    expect((await service.list(grant.id)).data.find((l) => l.id === a.id)).toMatchObject({
      reserved: '0.00',
      committed: '700.00',
    });

    const released = await service.release(FAKE_TX, prId, 'cancelled');
    expect(released).toHaveLength(1);
    expect(ledger.commitments[0]).toMatchObject({ status: 'released', releaseReason: 'cancelled' });
    expect((await service.list(grant.id)).data.find((l) => l.id === a.id)?.available).toBe(
      '1000.00'
    );
  });

  it('reserve beyond Available → BUDGET_EXCEEDED and nothing is held', async () => {
    const { a } = twoLines();
    ledger.hold(a.id, '900.00');
    const error = await expectAppError(
      service.reserve(FAKE_TX, prId, 1, [{ budgetLineId: a.id, amount: '200.00' }]),
      'BUDGET_EXCEEDED'
    );
    expect(error.details).toMatchObject({ lines: [{ shortfall: '100.00' }] });
    expect(ledger.commitments.filter((c) => c.prId === prId)).toHaveLength(0);
  });

  it('a resubmission cycle reserves again after the previous cycle was released', async () => {
    const { a } = twoLines();
    await service.reserve(FAKE_TX, prId, 1, [{ budgetLineId: a.id, amount: '100.00' }]);
    await service.release(FAKE_TX, prId, 'returned');
    await service.reserve(FAKE_TX, prId, 2, [{ budgetLineId: a.id, amount: '150.00' }]);
    expect(ledger.commitments.filter((c) => c.status === 'reserved')).toMatchObject([
      { cycle: 2, amount: '150.00' },
    ]);
  });

  it('moveReservation re-checks the target (own holds count as requested), then moves', async () => {
    const { a, b } = twoLines();
    await service.reserve(FAKE_TX, prId, 1, [{ budgetLineId: a.id, amount: '400.00' }]);
    ledger.hold(b.id, '200.00'); // another PR

    await service.moveReservation(FAKE_TX, prId, 1, a.id, b.id, '250.00');
    const mine = ledger.commitments.filter((c) => c.prId === prId);
    expect(mine.find((c) => c.budgetLineId === a.id)).toMatchObject({ amount: '150.00' });
    expect(mine.find((c) => c.budgetLineId === b.id)).toMatchObject({
      amount: '250.00',
      status: 'reserved',
    });

    // moving the other 150 needs 400 on b (250 own + 150) but other PRs leave only 300
    await expectAppError(
      service.moveReservation(FAKE_TX, prId, 1, a.id, b.id, '150.00'),
      'BUDGET_EXCEEDED'
    );
  });

  it('moving a whole reservation releases the source with reason budget_line_changed', async () => {
    const { a, b } = twoLines();
    await service.reserve(FAKE_TX, prId, 1, [{ budgetLineId: a.id, amount: '100.00' }]);
    await service.moveReservation(FAKE_TX, prId, 1, a.id, b.id, '100.00');
    expect(ledger.commitments.find((c) => c.budgetLineId === a.id)).toMatchObject({
      status: 'released',
      releaseReason: 'budget_line_changed',
    });
  });
});
