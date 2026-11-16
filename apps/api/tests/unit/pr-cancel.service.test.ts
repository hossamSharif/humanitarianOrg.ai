// T129 — cancel: a reason is required; the creator cancels a pending or returned PR, a holder of
// pr:cancel_approved cancels any pending, returned or approved PR; holds are released as
// cancelled, open steps close and the requester is told when someone else cancelled (US6-1,
// US6-2, FR-041, FR-042).
import { SEEDED_ROLES, type Permission } from '@ngo/shared';
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

const ADMIN_ID = '00000000-0000-4000-8000-00000000a0a0';

function world() {
  const w = buildPrWorld();
  w.db.actors.set(ADMIN_ID, { nameAr: 'المدير', nameEn: 'Sara Admin', position: 'Ops Manager' });
  return w;
}

async function sign(w: PrWorld, prId: string, userId: string) {
  const { pr, step } = await w.current(prId);
  return w.as(userId).approve(prId, { expectedVersion: pr.version, stepId: step!.id });
}

async function approved(w: PrWorld) {
  const pr = await w.seedSubmitted();
  await sign(w, pr.id, w.financeUserId);
  await sign(w, pr.id, w.approverUserId);
  return (await w.db.find(pr.id))!;
}

async function returned(w: PrWorld) {
  const pr = await w.seedSubmitted();
  const { pr: current, step } = await w.current(pr.id);
  await w.as(w.financeUserId).return(pr.id, {
    expectedVersion: current.version,
    stepId: step!.id,
    reason: 'Wrong unit',
  });
  return (await w.db.find(pr.id))!;
}

async function cancel(
  w: PrWorld,
  prId: string,
  as: { userId: string; role?: keyof typeof SEEDED_ROLES } | 'creator',
  reason = 'Activity postponed'
) {
  const pr = (await w.db.find(prId))!;
  const workflow = as === 'creator' ? w.workflow() : w.as(as.userId, as.role);
  return workflow.cancel(prId, { expectedVersion: pr.version, reason });
}

const admin = { userId: ADMIN_ID, role: 'org_admin' } as const;

describe('PR cancel', () => {
  it('requires a reason', async () => {
    const w = world();
    const pr = await w.seedSubmitted();
    const err = await failure(cancel(w, pr.id, 'creator', '  '));
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual([{ field: 'reason', message: 'required' }]);
  });

  it('the creator cancels a pending PR: hold released, open steps cancelled, no notification', async () => {
    const w = world();
    const pr = await w.seedSubmitted();
    w.notifications.rows.length = 0;

    const result = await cancel(w, pr.id, 'creator');
    expect(result).toEqual({
      id: pr.id,
      status: 'cancelled',
      version: pr.version + 1,
      currentStepOrder: null,
    });
    expect(await w.db.find(pr.id)).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Activity postponed',
      number: pr.number,
    });
    expect(w.db.closing.get(pr.id)).toMatchObject({
      cancelledBy: w.requesterId,
      closedAt: '2026-11-15T09:00:00.000Z',
    });
    expect(w.steps.rows.map((s) => s.status)).toEqual(['cancelled', 'cancelled']);
    expect(w.ledger.commitments).toEqual([
      expect.objectContaining({ status: 'released', releaseReason: 'cancelled' }),
    ]);
    expect(w.actions.rows.at(-1)).toMatchObject({
      action: 'cancel',
      cycle: 1,
      stepId: null,
      stepOrder: null,
      comment: 'Activity postponed',
      userName: 'Amna Requester',
    });
    expect(w.notifications.rows).toEqual([]);
  });

  it('the creator cancels during the final approval: the signed finance step stays approved', async () => {
    const w = world();
    const pr = await w.seedSubmitted();
    await sign(w, pr.id, w.financeUserId);
    await cancel(w, pr.id, 'creator');
    expect(w.steps.rows.map((s) => s.status)).toEqual(['approved', 'cancelled']);
  });

  it('the creator cancels a returned PR (nothing held any more)', async () => {
    const w = world();
    const pr = await returned(w);
    await expect(cancel(w, pr.id, 'creator')).resolves.toMatchObject({ status: 'cancelled' });
    expect(w.ledger.commitments).toEqual([
      expect.objectContaining({ status: 'released', releaseReason: 'returned' }),
    ]);
  });

  it.each(['pending', 'returned'] as const)(
    'a holder of pr:cancel_approved cancels another user’s %s PR and the requester is notified',
    async (state) => {
      const w = world();
      const pr = state === 'pending' ? await w.seedSubmitted() : await returned(w);
      w.notifications.rows.length = 0;
      await expect(cancel(w, pr.id, admin)).resolves.toMatchObject({ status: 'cancelled' });
      expect(w.db.closing.get(pr.id)).toMatchObject({ cancelledBy: ADMIN_ID });
      expect(w.notifications.rows).toEqual([
        expect.objectContaining({ userId: w.requesterId, kind: 'pr_cancelled', prId: pr.id }),
      ]);
    }
  );

  it('a non-creator without pr:cancel_approved → FORBIDDEN', async () => {
    const w = world();
    const pr = await w.seedSubmitted();
    const err = await failure(cancel(w, pr.id, { userId: w.financeUserId }));
    expect(err.code).toBe('FORBIDDEN');
    expect(w.ledger.commitments[0]!.status).toBe('reserved');
  });

  it('approved PR with pr:cancel_approved: committed → released as cancelled (US6-1, FR-042)', async () => {
    const w = world();
    const pr = await approved(w);
    expect(w.ledger.commitments.map((c) => c.status)).toEqual(['committed']);
    w.notifications.rows.length = 0;

    await expect(cancel(w, pr.id, admin, 'Donor withdrew funding')).resolves.toMatchObject({
      status: 'cancelled',
      currentStepOrder: null,
    });
    expect(w.ledger.commitments).toEqual([
      expect.objectContaining({ status: 'released', releaseReason: 'cancelled' }),
    ]);
    // signatures stay as signed
    expect(w.steps.rows.map((s) => s.status)).toEqual(['approved', 'approved']);
    expect(w.actions.rows.at(-1)).toMatchObject({
      action: 'cancel',
      comment: 'Donor withdrew funding',
      userName: 'Sara Admin',
    });
    expect(w.notifications.rows).toEqual([
      expect.objectContaining({ userId: w.requesterId, kind: 'pr_cancelled' }),
    ]);
  });

  it('approved PR without pr:cancel_approved → FORBIDDEN, even for the creator (US6-2)', async () => {
    const w = world();
    const pr = await approved(w);
    expect((await failure(cancel(w, pr.id, 'creator'))).code).toBe('FORBIDDEN');
    expect((await failure(cancel(w, pr.id, { userId: w.approverUserId }))).code).toBe('FORBIDDEN');
    expect(w.ledger.commitments[0]!.status).toBe('committed');
  });

  it('availableActions offers cancel only where the command would accept it', async () => {
    const w = world();
    const pending = await w.seedSubmitted();
    const done = await approved(w);
    const withCancelApproved = new Set<Permission>(SEEDED_ROLES.org_admin.permissions);

    const actionsOf = async (prId: string, userId: string, permissions?: Set<Permission>) =>
      (await w.prService({ userId, ...(permissions && { permissions }) }).getDetail(prId))
        .availableActions;

    expect(await actionsOf(pending.id, w.requesterId)).toContain('cancel');
    expect(await actionsOf(pending.id, w.financeUserId)).not.toContain('cancel');
    expect(await actionsOf(pending.id, ADMIN_ID, withCancelApproved)).toContain('cancel');
    expect(await actionsOf(done.id, w.requesterId)).not.toContain('cancel');
    expect(await actionsOf(done.id, ADMIN_ID, withCancelApproved)).toContain('cancel');
  });

  it.each(['draft', 'rejected', 'cancelled'] as const)('%s → INVALID_STATE', async (status) => {
    const w = world();
    let pr;
    if (status === 'draft') {
      pr = w.seedDraft();
    } else {
      pr = await w.seedSubmitted();
      const { pr: current, step } = await w.current(pr.id);
      if (status === 'rejected') {
        await w.as(w.financeUserId).reject(pr.id, {
          expectedVersion: current.version,
          stepId: step!.id,
          reason: 'Not eligible',
        });
      } else {
        await cancel(w, pr.id, 'creator');
      }
    }
    expect((await failure(cancel(w, pr.id, admin))).code).toBe('INVALID_STATE');
  });

  it('a stale version → VERSION_CONFLICT', async () => {
    const w = world();
    const pr = await w.seedSubmitted();
    const err = await failure(
      w.workflow().cancel(pr.id, { expectedVersion: pr.version - 1, reason: 'Postponed' })
    );
    expect(err.code).toBe('VERSION_CONFLICT');
  });
});
