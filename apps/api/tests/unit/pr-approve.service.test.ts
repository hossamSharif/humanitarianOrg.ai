// T113 — signing steps: the finance check advances to the final approval, the final approval
// commits the budget and approves the PR; signatures keep the name and position at signing;
// segregation of duties and the approve-only grant guards (US5-1..US5-3, FR-031, FR-034, FR-036,
// Business Rules 5–6).
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/middleware/error';
import { buildPrWorld, type PrWorld } from './helpers/pr-fakes';
import { buildCandidate } from './helpers/routing-store';

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected the command to fail');
}

/** Submitted PR plus a helper that signs its current step as `userId`. */
async function submitted(w: PrWorld) {
  const pr = await w.seedSubmitted();
  const sign = async (userId: string, comment?: string) => {
    const { pr: current, step } = await w.current(pr.id);
    return w.as(userId).approve(pr.id, {
      expectedVersion: current.version,
      stepId: step!.id,
      comment,
    });
  };
  return { pr, sign };
}

describe('PR approve', () => {
  it('finance check → pending_approval, the final step becomes pending and its users are notified', async () => {
    const w = buildPrWorld();
    const { pr, sign } = await submitted(w);
    w.notifications.rows.length = 0;

    const result = await sign(w.financeUserId, 'Budget verified');
    expect(result).toEqual({
      id: pr.id,
      status: 'pending_approval',
      version: pr.version + 1,
      currentStepOrder: 2,
    });
    expect(w.steps.rows.map((s) => s.status)).toEqual(['approved', 'pending']);
    expect(w.steps.rows[0]!.actedAt).toBe('2026-11-15T09:00:00.000Z');
    expect(w.notifications.rows).toEqual([
      {
        userId: w.approverUserId,
        kind: 'pr_action_required',
        prId: pr.id,
        params: { number: pr.number, stepKind: 'final_approval', actorName: 'Fatima Finance' },
      },
    ]);
    // still only reserved
    expect(w.ledger.commitments.map((c) => c.status)).toEqual(['reserved']);
  });

  it('final approval → approved, approved_at set, reserved → committed, requester notified (US5-1, FR-036)', async () => {
    const w = buildPrWorld();
    const { pr, sign } = await submitted(w);
    await sign(w.financeUserId);
    const before = await w.ledger.usage(null as never, [w.budgetLineId]);
    w.notifications.rows.length = 0;

    const result = await sign(w.approverUserId);
    expect(result).toMatchObject({ status: 'approved', currentStepOrder: null });
    expect((await w.db.find(pr.id))!).toMatchObject({
      status: 'approved',
      approvedAt: '2026-11-15T09:00:00.000Z',
    });
    expect(w.ledger.commitments).toEqual([
      expect.objectContaining({ prId: pr.id, status: 'committed', amount: '1451.18' }),
    ]);
    // Available unchanged: the amount moves from Reserved to Committed
    const after = await w.ledger.usage(null as never, [w.budgetLineId]);
    expect(before.get(w.budgetLineId)).toEqual({ reserved: '1451.18', committed: '0.00' });
    expect(after.get(w.budgetLineId)).toEqual({ reserved: '0.00', committed: '1451.18' });
    expect(w.notifications.rows).toEqual([
      {
        userId: w.requesterId,
        kind: 'pr_approved',
        prId: pr.id,
        params: { number: pr.number, stepKind: null, actorName: 'Omer Approver' },
      },
    ]);
  });

  it('stores each signature with the name and position at signing (FR-031)', async () => {
    const w = buildPrWorld();
    const { pr, sign } = await submitted(w);
    await sign(w.financeUserId, 'OK');
    // a later position change does not alter the stored signature
    w.db.actors.get(w.financeUserId)!.position = 'Head of Finance';
    await sign(w.approverUserId);

    const signatures = w.actions.rows.filter((a) => a.action === 'approve');
    expect(signatures).toEqual([
      expect.objectContaining({
        prId: pr.id,
        userId: w.financeUserId,
        cycle: 1,
        stepOrder: 1,
        stepId: w.steps.rows[0]!.id,
        userName: 'Fatima Finance',
        userPosition: 'Finance Officer',
        comment: 'OK',
      }),
      expect.objectContaining({
        userId: w.approverUserId,
        stepOrder: 2,
        userName: 'Omer Approver',
        userPosition: 'Area Manager',
        comment: null,
      }),
    ]);
  });

  it('the creator cannot sign their own PR → SEGREGATION_OF_DUTIES (US5-2, Business Rule 5)', async () => {
    const w = buildPrWorld();
    // the requester also holds the finance checker role
    w.routing.members.push(buildCandidate({ userId: w.requesterId, roleIds: [w.roles.finance] }));
    const { sign } = await submitted(w);
    const err = await failure(sign(w.requesterId));
    expect(err.code).toBe('SEGREGATION_OF_DUTIES');
  });

  it('the finance signer cannot sign the final step → SEGREGATION_OF_DUTIES (US5-3, Business Rule 6)', async () => {
    const w = buildPrWorld();
    // the finance user also holds the approver role
    w.routing.members.find((m) => m.userId === w.financeUserId)!.roleIds = [
      w.roles.finance,
      w.roles.approver,
    ];
    const { sign } = await submitted(w);
    await sign(w.financeUserId);
    const err = await failure(sign(w.financeUserId));
    expect(err.code).toBe('SEGREGATION_OF_DUTIES');
    expect(w.ledger.commitments[0]!.status).toBe('reserved');
  });

  it('a user without the step role → FORBIDDEN', async () => {
    const w = buildPrWorld();
    const { sign } = await submitted(w);
    const err = await failure(sign(w.approverUserId));
    expect(err.code).toBe('FORBIDDEN');
  });

  it.each(['suspended', 'closed'] as const)(
    'a %s grant blocks approval → GRANT_NOT_ACTIVE, reservation kept (FR-022)',
    async (status) => {
      const w = buildPrWorld();
      const { sign } = await submitted(w);
      w.db.grants.get(w.grantId)!.status = status;
      const err = await failure(sign(w.financeUserId));
      expect(err.code).toBe('GRANT_NOT_ACTIVE');
      expect(w.ledger.commitments[0]!.status).toBe('reserved');
      expect(w.actions.rows.filter((a) => a.action === 'approve')).toHaveLength(0);
    }
  );

  it('a grant whose dates no longer cover the PR date → GRANT_PERIOD_MISMATCH (FR-034)', async () => {
    const w = buildPrWorld();
    const { sign } = await submitted(w);
    await sign(w.financeUserId);
    w.db.grants.get(w.grantId)!.endDate = '2026-11-09';
    const err = await failure(sign(w.approverUserId));
    expect(err.code).toBe('GRANT_PERIOD_MISMATCH');
  });

  it('a step that is not the current pending one → INVALID_STATE', async () => {
    const w = buildPrWorld();
    const { pr } = await submitted(w);
    const finalStep = w.steps.rows[1]!;
    const err = await failure(
      w.as(w.approverUserId).approve(pr.id, { expectedVersion: 2, stepId: finalStep.id })
    );
    expect(err.code).toBe('INVALID_STATE');
  });

  it.each(['draft', 'approved', 'rejected', 'returned'] as const)(
    'a %s PR → INVALID_STATE',
    async (status) => {
      const w = buildPrWorld();
      const { pr } = await submitted(w);
      w.db.prs.get(pr.id)!.status = status;
      const err = await failure(
        w.as(w.financeUserId).approve(pr.id, { expectedVersion: 2, stepId: w.steps.rows[0]!.id })
      );
      expect(err.code).toBe('INVALID_STATE');
    }
  );

  it('a stale version → VERSION_CONFLICT', async () => {
    const w = buildPrWorld();
    const { pr } = await submitted(w);
    const err = await failure(
      w.as(w.financeUserId).approve(pr.id, { expectedVersion: 1, stepId: w.steps.rows[0]!.id })
    );
    expect(err.code).toBe('VERSION_CONFLICT');
  });

  it('exposes canApprove and the approve action to the eligible user only', async () => {
    const w = buildPrWorld();
    const { pr } = await submitted(w);
    const forFinance = await w
      .prService({ userId: w.financeUserId, permissions: new Set(['pr:read', 'pr:finance_check']) })
      .getDetail(pr.id);
    expect(forFinance.steps[0]).toMatchObject({ canApprove: true, canChangeBudgetLine: true });
    expect(forFinance.availableActions).toEqual(
      expect.arrayContaining(['approve', 'reject', 'return', 'change_budget_line'])
    );

    const forRequester = await w.prService().getDetail(pr.id);
    expect(forRequester.steps[0]!.canApprove).toBe(false);
    expect(forRequester.availableActions).not.toContain('approve');

    w.db.grants.get(w.grantId)!.status = 'suspended';
    const frozen = await w
      .prService({ userId: w.financeUserId, permissions: new Set(['pr:read', 'pr:finance_check']) })
      .getDetail(pr.id);
    expect(frozen.grantFrozen).toBe(true);
    expect(frozen.availableActions).not.toContain('approve');
    expect(frozen.availableActions).toEqual(expect.arrayContaining(['reject', 'return']));
  });
});
