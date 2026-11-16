// T114 — reject and return: a reason is required, holds are released with the matching reason,
// the requester is notified; a returned PR is resubmitted with its number, fresh rates, a new
// cycle from step 1 and a fresh reservation (US5-5, US5-7, FR-032, FR-038).
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/middleware/error';
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

async function act(
  w: PrWorld,
  prId: string,
  userId: string,
  action: 'approve' | 'reject' | 'return',
  reason = 'Quotation missing'
) {
  const { pr, step } = await w.current(prId);
  const input = { expectedVersion: pr.version, stepId: step!.id };
  const workflow = w.as(userId);
  return action === 'approve'
    ? workflow.approve(prId, input)
    : workflow[action](prId, { ...input, reason });
}

describe('PR reject and return', () => {
  it.each(['reject', 'return'] as const)('%s requires a reason', async (action) => {
    const w = buildPrWorld();
    const pr = await w.seedSubmitted();
    const err = await failure(act(w, pr.id, w.financeUserId, action, '   '));
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual([{ field: 'reason', message: 'required' }]);
  });

  it('reject → rejected, steps closed, holds released as rejected, requester notified', async () => {
    const w = buildPrWorld();
    const pr = await w.seedSubmitted();
    w.notifications.rows.length = 0;

    const result = await act(w, pr.id, w.financeUserId, 'reject', 'Not eligible under the grant');
    expect(result).toMatchObject({ status: 'rejected', currentStepOrder: null });
    expect(await w.db.find(pr.id)).toMatchObject({
      status: 'rejected',
      rejectReason: 'Not eligible under the grant',
    });
    expect(w.db.closing.get(pr.id)).toMatchObject({
      rejectedBy: w.financeUserId,
      closedAt: '2026-11-15T09:00:00.000Z',
    });
    expect(w.steps.rows.map((s) => s.status)).toEqual(['rejected', 'cancelled']);
    expect(w.ledger.commitments).toEqual([
      expect.objectContaining({ status: 'released', releaseReason: 'rejected' }),
    ]);
    expect(w.actions.rows.at(-1)).toMatchObject({
      action: 'reject',
      comment: 'Not eligible under the grant',
      stepOrder: 1,
      userName: 'Fatima Finance',
    });
    expect(w.notifications.rows).toEqual([
      expect.objectContaining({ userId: w.requesterId, kind: 'pr_rejected', prId: pr.id }),
    ]);
  });

  it('return → returned with the reason, open steps closed, holds released as returned', async () => {
    const w = buildPrWorld();
    const pr = await w.seedSubmitted();
    await act(w, pr.id, w.financeUserId, 'approve');
    w.notifications.rows.length = 0;

    const result = await act(w, pr.id, w.approverUserId, 'return', 'Add specifications');
    expect(result).toMatchObject({ status: 'returned', currentStepOrder: null });
    expect(await w.db.find(pr.id)).toMatchObject({
      status: 'returned',
      returnReason: 'Add specifications',
      number: pr.number,
    });
    expect(w.steps.rows.map((s) => s.status)).toEqual(['approved', 'returned']);
    expect(w.ledger.commitments).toEqual([
      expect.objectContaining({ status: 'released', releaseReason: 'returned' }),
    ]);
    expect(w.notifications.rows).toEqual([
      expect.objectContaining({ userId: w.requesterId, kind: 'pr_returned' }),
    ]);
  });

  it('return at the finance check cancels the waiting final step', async () => {
    const w = buildPrWorld();
    const pr = await w.seedSubmitted();
    await act(w, pr.id, w.financeUserId, 'return');
    expect(w.steps.rows.map((s) => s.status)).toEqual(['returned', 'cancelled']);
  });

  it('the requester cannot reject or return their own PR', async () => {
    const w = buildPrWorld();
    const pr = await w.seedSubmitted();
    const err = await failure(act(w, pr.id, w.requesterId, 'return'));
    expect(err.code).toBe('SEGREGATION_OF_DUTIES');
  });

  it('a frozen grant still allows reject and return (FR-022)', async () => {
    const w = buildPrWorld();
    const pr = await w.seedSubmitted();
    w.db.grants.get(w.grantId)!.status = 'suspended';
    await expect(act(w, pr.id, w.financeUserId, 'return')).resolves.toMatchObject({
      status: 'returned',
    });
    expect(w.ledger.commitments[0]!.status).toBe('released');
  });

  describe('resubmission after a return (US5-5, US5-7, FR-038)', () => {
    async function returned(w: PrWorld) {
      const pr = await w.seedSubmitted();
      await act(w, pr.id, w.financeUserId, 'approve');
      await act(w, pr.id, w.approverUserId, 'return', 'Wrong unit');
      return (await w.db.find(pr.id))!;
    }

    it('keeps the number, re-locks rates entered since, restarts at step 1 in cycle 2', async () => {
      const w = buildPrWorld();
      const pr = await returned(w);
      // a rate entered after the first submission, still dated on or before the PR date
      w.rates.add({ currency: 'USD', rateToBase: '625', rateDate: '2026-11-09' });

      const result = await w.workflow().submit(pr.id, { expectedVersion: pr.version });
      expect(result.number).toBe(pr.number);
      expect(result.steps).toEqual([
        { stepOrder: 1, kind: 'finance_check', status: 'pending' },
        { stepOrder: 2, kind: 'final_approval', status: 'waiting' },
      ]);
      const stored = (await w.db.find(pr.id))!;
      expect(stored).toMatchObject({ submissionCycle: 2, currentStepOrder: 1 });
      expect(stored.grantRateToBase).toBe('625');
      // 870,710.00 / 625 = 1,393.136 → 1,393.14
      expect((await w.db.lines(pr.id))[0]!.amountGrant).toBe('1393.14');
      expect(w.ledger.commitments).toEqual([
        expect.objectContaining({ cycle: 1, status: 'released', releaseReason: 'returned' }),
        expect.objectContaining({ cycle: 2, status: 'reserved', amount: '1393.14' }),
      ]);
    });

    it('runs a fresh availability check: budget used since the return → BUDGET_EXCEEDED', async () => {
      const w = buildPrWorld();
      const pr = await returned(w);
      w.ledger.hold(w.budgetLineId, '9000.00', 'committed');
      const err = await failure(w.workflow().submit(pr.id, { expectedVersion: pr.version }));
      expect(err.code).toBe('BUDGET_EXCEEDED');
    });

    it('the cycle-1 finance checker signs the finance check again but not the final approval (FR-032)', async () => {
      const w = buildPrWorld();
      // the finance user may also approve
      w.routing.members.find((m) => m.userId === w.financeUserId)!.roleIds = [
        w.roles.finance,
        w.roles.approver,
      ];
      const pr = await returned(w);
      await w.workflow().submit(pr.id, { expectedVersion: pr.version });

      await expect(act(w, pr.id, w.financeUserId, 'approve')).resolves.toMatchObject({
        status: 'pending_approval',
      });
      const err = await failure(act(w, pr.id, w.financeUserId, 'approve'));
      expect(err.code).toBe('SEGREGATION_OF_DUTIES');
      await expect(act(w, pr.id, w.approverUserId, 'approve')).resolves.toMatchObject({
        status: 'approved',
      });
    });
  });
});
