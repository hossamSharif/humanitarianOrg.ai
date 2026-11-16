// T116 — an administrator with pr:reassign assigns an open step to one eligible user; the step
// then admits only that user, the change is logged and the new user notified (US5-6, FR-039).
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

const ADMIN_ID = '00000000-0000-4000-8000-00000000a0a0';

async function setup(w: PrWorld) {
  w.db.actors.set(ADMIN_ID, { nameAr: 'المدير', nameEn: 'Sara Admin', position: 'Ops Manager' });
  const second = buildCandidate({ roleIds: [w.roles.finance] });
  w.routing.members.push(second);
  w.db.actors.set(second.userId, { nameAr: 'مدقق', nameEn: 'Second Finance', position: null });
  const pr = await w.seedSubmitted();
  const { step } = await w.current(pr.id);
  const reassign = (userId: string, role: 'org_admin' | 'approver' = 'org_admin') =>
    w.as(ADMIN_ID, role).reassign(pr.id, step!.id, {
      expectedVersion: pr.version,
      userId,
      reason: 'Fatima on leave',
    });
  return { pr, step: step!, second, reassign };
}

describe('PR reassign', () => {
  it('requires pr:reassign → FORBIDDEN', async () => {
    const w = buildPrWorld();
    const { second, reassign } = await setup(w);
    expect((await failure(reassign(second.userId, 'approver'))).code).toBe('FORBIDDEN');
  });

  it('the target must be eligible for the step → VALIDATION_ERROR', async () => {
    const w = buildPrWorld();
    const { reassign } = await setup(w);
    // the approver lacks the finance checker role; the requester is the creator
    for (const userId of [w.approverUserId, w.requesterId]) {
      const err = await failure(reassign(userId));
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details).toEqual([{ field: 'userId', message: 'not_eligible' }]);
    }
  });

  it('assigns the step, logs from/to with the reason and notifies the new user', async () => {
    const w = buildPrWorld();
    const { pr, step, second, reassign } = await setup(w);
    w.notifications.rows.length = 0;

    const result = await reassign(second.userId);
    expect(result).toMatchObject({ status: 'pending_finance_check', version: pr.version + 1 });
    expect(w.steps.rows.find((s) => s.id === step.id)!.assignedUserId).toBe(second.userId);
    expect(w.actions.rows.at(-1)).toMatchObject({
      action: 'reassign',
      userId: ADMIN_ID,
      userName: 'Sara Admin',
      comment: 'Fatima on leave',
      stepId: step.id,
      payload: { fromUserId: null, toUserId: second.userId },
    });
    expect(w.notifications.rows).toEqual([
      {
        userId: second.userId,
        kind: 'pr_reassigned',
        prId: pr.id,
        params: { number: pr.number, stepKind: 'finance_check', actorName: 'Sara Admin' },
      },
    ]);
  });

  it('after reassignment only the assignee may sign', async () => {
    const w = buildPrWorld();
    const { pr, step, second, reassign } = await setup(w);
    const { version } = await reassign(second.userId);
    const err = await failure(
      w.as(w.financeUserId).approve(pr.id, { expectedVersion: version, stepId: step.id })
    );
    expect(err.code).toBe('FORBIDDEN');
    await expect(
      w
        .as(second.userId, 'finance_checker')
        .approve(pr.id, { expectedVersion: version, stepId: step.id })
    ).resolves.toMatchObject({ status: 'pending_approval' });
  });

  it('a closed PR cannot be reassigned → INVALID_STATE', async () => {
    const w = buildPrWorld();
    const { pr, second, reassign } = await setup(w);
    w.db.prs.get(pr.id)!.status = 'approved';
    expect((await failure(reassign(second.userId))).code).toBe('INVALID_STATE');
  });

  it('lists the eligible users of a step for the reassign dialog', async () => {
    const w = buildPrWorld();
    const { pr, step, second } = await setup(w);
    const users = await w
      .prService({ userId: ADMIN_ID, permissions: new Set(['pr:read', 'pr:reassign']) })
      .eligibleUsers(pr.id, step.id);
    expect(users.map((u) => u.userId).sort()).toEqual([w.financeUserId, second.userId].sort());
    expect(users.find((u) => u.userId === second.userId)).toMatchObject({
      nameEn: 'Second Finance',
    });
  });
});
