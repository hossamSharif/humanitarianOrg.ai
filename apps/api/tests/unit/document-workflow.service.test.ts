// T007 — the generic document workflow (research D1) through an in-memory adapter: numbering
// at first submission, route materialisation, eligibility and segregation, final approval
// effects, reasons, releases, reassignment, optimistic versions and frozen grants (FR-096).
import { PERMISSIONS, PERMISSIONS_002 } from '@ngo/shared';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/middleware/error';
import { FakeDocWorld } from './helpers/doc-workflow-fakes';

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected the command to fail');
}

async function submitted(w: FakeDocWorld, overrides = {}) {
  const doc = w.seed(overrides);
  await w.as(w.creatorId).submit(doc.id, { expectedVersion: doc.version });
  return w.doc(doc.id);
}

const approve = (w: FakeDocWorld, id: string, userId: string, extra = {}) =>
  w.as(userId, [PERMISSIONS_002.PAYMENT_OVERRIDE_MATCH]).approve(id, {
    expectedVersion: w.doc(id).version,
    stepId: w.currentStep(id).id,
    ...extra,
  });

describe('submit', () => {
  it('assigns the number on the first submission, materialises the route and notifies step 1', async () => {
    const w = new FakeDocWorld();
    const doc = w.seed();
    const outcome = await w.as(w.creatorId).submit(doc.id, { expectedVersion: 1 });

    expect(outcome).toMatchObject({ number: 'PO-MAD-2026-0001', status: 'pending_approval' });
    expect(outcome.steps).toEqual([
      { stepOrder: 1, kind: 'approval', status: 'pending' },
      { stepOrder: 2, kind: 'final_approval', status: 'waiting' },
    ]);
    expect(w.doc(doc.id)).toMatchObject({ submissionCycle: 1, currentStepOrder: 1 });
    expect(w.effects).toEqual([`reserve:${doc.id}:1`]);
    expect(w.signatures.map((s) => s.action)).toEqual(['submit']);
    expect(w.notified).toEqual([{ kind: 'step', docId: doc.id, userIds: [w.fm.userId] }]);
  });

  it('keeps the number on resubmission after a return and starts a new cycle', async () => {
    const w = new FakeDocWorld();
    const doc = await submitted(w);
    await w.as(w.fm.userId).return(doc.id, {
      expectedVersion: w.doc(doc.id).version,
      stepId: w.currentStep(doc.id).id,
      reason: 'Fix the quantities',
    });
    const again = await w
      .as(w.creatorId)
      .submit(doc.id, { expectedVersion: w.doc(doc.id).version });

    expect(again.number).toBe(doc.number);
    expect(w.numbers.get('PO')).toBe(1);
    expect(w.doc(doc.id).submissionCycle).toBe(2);
    expect(w.steps.filter((s) => s.cycle === 2).map((s) => s.status)).toEqual([
      'pending',
      'waiting',
    ]);
    expect(w.signatures.at(-1)!.payload).toMatchObject({ resubmission: true });
  });

  it('refuses a stale expectedVersion with VERSION_CONFLICT', async () => {
    const w = new FakeDocWorld();
    const doc = w.seed({ version: 3 });
    expect((await failure(w.as(w.creatorId).submit(doc.id, { expectedVersion: 2 }))).code).toBe(
      'VERSION_CONFLICT'
    );
    expect(w.numbers.size).toBe(0);
  });
});

describe('approve', () => {
  it('a non-final step advances the route; the final step runs onApproved and notifies the creator', async () => {
    const w = new FakeDocWorld();
    const doc = await submitted(w);

    const first = await approve(w, doc.id, w.fm.userId);
    expect(first).toMatchObject({ status: 'pending_approval', currentStepOrder: 2, docType: 'PO' });
    expect(w.effects).not.toContain(`commit:${doc.id}`);

    const final = await approve(w, doc.id, w.cd.userId);
    expect(final).toMatchObject({ status: 'approved', currentStepOrder: null });
    expect(w.effects).toContain(`commit:${doc.id}`);
    expect(w.doc(doc.id).approvedAt).toBe('2026-11-16T08:00:00.000Z');
    expect(w.notified.at(-1)).toEqual({ kind: 'creator', docId: doc.id, outcome: 'approved' });
    expect(w.signatures.filter((s) => s.action === 'approve').map((s) => s.userId)).toEqual([
      w.fm.userId,
      w.cd.userId,
    ]);
  });

  it('the creator cannot sign their own document → SEGREGATION_OF_DUTIES creator_approves', async () => {
    const w = new FakeDocWorld();
    const doc = await submitted(w);
    w.fm.userId = w.creatorId; // the creator also holds the Finance Manager role
    w.routing.members[0]!.userId = w.creatorId;

    const err = await failure(approve(w, doc.id, w.creatorId));
    expect(err.code).toBe('SEGREGATION_OF_DUTIES');
    expect(err.details).toEqual({ rule: 'creator_approves' });
  });

  it('one user cannot sign two steps → SEGREGATION_OF_DUTIES same_user_two_steps', async () => {
    const w = new FakeDocWorld();
    const doc = await submitted(w);
    w.fm.roleIds = [...w.fm.roleIds, w.cdRole]; // the Finance Manager also holds the Country Director role
    await approve(w, doc.id, w.fm.userId);

    const err = await failure(approve(w, doc.id, w.fm.userId));
    expect(err.code).toBe('SEGREGATION_OF_DUTIES');
    expect(err.details).toEqual({ rule: 'same_user_two_steps' });
    expect(w.doc(doc.id).status).toBe('pending_approval');
  });

  it('a user without the step role (or its permission) gets FORBIDDEN', async () => {
    const w = new FakeDocWorld();
    const doc = await submitted(w);
    expect((await failure(approve(w, doc.id, w.cd.userId))).code).toBe('FORBIDDEN');
  });

  it('only the current pending step can be signed', async () => {
    const w = new FakeDocWorld();
    const doc = await submitted(w);
    const waiting = w.steps.find((s) => s.docId === doc.id && s.status === 'waiting')!;
    const err = await failure(
      w
        .as(w.cd.userId)
        .approve(doc.id, { expectedVersion: w.doc(doc.id).version, stepId: waiting.id })
    );
    expect(err.code).toBe('INVALID_STATE');
  });

  it('refuses a stale expectedVersion with VERSION_CONFLICT', async () => {
    const w = new FakeDocWorld();
    const doc = await submitted(w);
    const err = await failure(
      w.as(w.fm.userId).approve(doc.id, { expectedVersion: 1, stepId: w.currentStep(doc.id).id })
    );
    expect(err.code).toBe('VERSION_CONFLICT');
  });

  it('a suspended grant blocks signing (FR-096); return stays allowed', async () => {
    const w = new FakeDocWorld();
    const doc = await submitted(w, { grantStatus: 'suspended' });
    expect((await failure(approve(w, doc.id, w.fm.userId))).code).toBe('GRANT_NOT_ACTIVE');
    expect(w.signatures.filter((s) => s.action === 'approve')).toEqual([]);

    await w.as(w.fm.userId).return(doc.id, {
      expectedVersion: w.doc(doc.id).version,
      stepId: w.currentStep(doc.id).id,
      reason: 'Grant suspended',
    });
    expect(w.doc(doc.id).status).toBe('returned');
  });

  it('a payment request passes a frozen grant with a Finance Manager override and reason', async () => {
    const w = new FakeDocWorld();
    w.docType = 'PAY';
    w.frozenGrantOverride = true;
    w.routing.roles[0]!.permissions.push('payment:approve'); // FM may sign the PAY approval
    const doc = await submitted(w, { grantStatus: 'closed' });

    expect((await failure(approve(w, doc.id, w.fm.userId))).code).toBe('GRANT_NOT_ACTIVE');
    const result = await approve(w, doc.id, w.fm.userId, {
      frozenGrantOverrideReason: 'Final payment for delivered goods',
    });
    expect(result.status).toBe('pending_approval');
    expect(w.signatures.at(-1)!.payload).toMatchObject({
      frozenGrantOverride: 'Final payment for delivered goods',
    });
  });
});

describe('reject, return, cancel', () => {
  it('reject and return require a reason', async () => {
    const w = new FakeDocWorld();
    const doc = await submitted(w);
    for (const action of ['reject', 'return'] as const) {
      const err = await failure(
        w.as(w.fm.userId)[action](doc.id, {
          expectedVersion: w.doc(doc.id).version,
          stepId: w.currentStep(doc.id).id,
          reason: '  ',
        })
      );
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details).toEqual([{ field: 'reason', message: 'required' }]);
    }
  });

  it('reject releases the holds, closes the waiting steps and notifies the creator', async () => {
    const w = new FakeDocWorld();
    const doc = await submitted(w);
    const result = await w.as(w.fm.userId).reject(doc.id, {
      expectedVersion: w.doc(doc.id).version,
      stepId: w.currentStep(doc.id).id,
      reason: 'Not eligible',
    });
    expect(result.status).toBe('rejected');
    expect(w.effects).toContain(`release:${doc.id}:rejected`);
    expect(w.steps.map((s) => s.status)).toEqual(['rejected', 'cancelled']);
    expect(w.notified.at(-1)).toEqual({ kind: 'creator', docId: doc.id, outcome: 'rejected' });
  });

  it('cancel requires a reason and calls onReleased', async () => {
    const w = new FakeDocWorld();
    const doc = await submitted(w);
    const reasonless = await failure(
      w.as(w.creatorId).cancel(doc.id, { expectedVersion: w.doc(doc.id).version, reason: '' })
    );
    expect(reasonless.code).toBe('VALIDATION_ERROR');

    const result = await w.as(w.creatorId).cancel(doc.id, {
      expectedVersion: w.doc(doc.id).version,
      reason: 'No longer needed',
    });
    expect(result.status).toBe('cancelled');
    expect(w.effects).toContain(`release:${doc.id}:cancelled`);
    expect(w.steps.map((s) => s.status)).toEqual(['cancelled', 'cancelled']);
    expect(w.signatures.at(-1)).toMatchObject({ action: 'cancel', comment: 'No longer needed' });
  });

  it('a draft cannot be cancelled (it is deleted instead)', async () => {
    const w = new FakeDocWorld();
    const doc = w.seed();
    const err = await failure(
      w.as(w.creatorId).cancel(doc.id, { expectedVersion: 1, reason: 'x' })
    );
    expect(err.code).toBe('INVALID_STATE');
  });
});

describe('reassign', () => {
  it('requires the type reassign permission or settings:manage', async () => {
    const w = new FakeDocWorld();
    const doc = await submitted(w);
    const body = {
      expectedVersion: w.doc(doc.id).version,
      userId: w.fm.userId,
      reason: 'Holiday cover',
    };
    const err = await failure(w.as(w.admin).reassign(doc.id, w.currentStep(doc.id).id, body));
    expect(err.code).toBe('FORBIDDEN');

    const result = await w
      .as(w.admin, [PERMISSIONS.SETTINGS_MANAGE])
      .reassign(doc.id, w.currentStep(doc.id).id, body);
    expect(result.version).toBe(body.expectedVersion + 1);
    expect(w.currentStep(doc.id).assignedUserId).toBe(w.fm.userId);
    expect(w.notified.at(-1)).toEqual({
      kind: 'reassigned',
      docId: doc.id,
      userIds: [w.fm.userId],
    });
  });

  it('only to an eligible user', async () => {
    const w = new FakeDocWorld();
    const doc = await submitted(w);
    const err = await failure(
      w.as(w.admin, [PERMISSIONS.SETTINGS_MANAGE]).reassign(doc.id, w.currentStep(doc.id).id, {
        expectedVersion: w.doc(doc.id).version,
        userId: w.cd.userId,
        reason: 'x',
      })
    );
    expect(err.code).toBe('VALIDATION_ERROR');
  });
});
