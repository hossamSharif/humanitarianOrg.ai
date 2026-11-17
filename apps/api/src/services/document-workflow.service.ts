// One approval engine for every DoA-routed document (research D1, generalized from 001's
// pr-workflow.service.ts). Each command runs in one tenant transaction that locks the document
// first (the adapter's load) and then its budget lines in ascending id order (inside the
// adapter's budget hooks), so numbering, budget effects, signatures, step changes and
// notifications commit together or not at all (001 R4). Rules shared by every type live here;
// what differs per type comes from a DocAdapter (doc-adapters/types.ts).
import {
  PERMISSIONS_002,
  type DocActionResult,
  type DocApprove,
  type DocCancel,
  type PrEligibleUser,
  type DocReasonAction,
  type DocReassign,
  type DocStepView,
  type DocSubmit,
} from '@ngo/shared';
import type { TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import type { EligibilityStep } from './approval-routing.service';
import type {
  DocAdapter,
  MaterialisedStep,
  WorkflowActor,
  WorkflowBinding,
  WorkflowDoc,
  WorkflowStep,
} from './doc-adapters/types';
import { assertCanSign } from './segregation.service';

export interface DocumentWorkflowDeps<D extends WorkflowDoc, S> {
  actor: WorkflowActor;
  /** opens the command's transaction and binds the adapter and stores to it */
  run<T>(fn: (binding: WorkflowBinding<D, S>, tx: TenantTx) => Promise<T>): Promise<T>;
  now?: () => Date;
}

/** A reassignment target (the 001 PR shape). */
export type DocEligibleUser = PrEligibleUser;

export interface SubmitOutcome<D, S> {
  doc: D;
  number: string;
  version: number;
  status: string;
  steps: MaterialisedStep[];
  state: S;
}

function requireReason(reason: string | null | undefined): string {
  const trimmed = reason?.trim() ?? '';
  if (!trimmed) {
    throw new AppError('VALIDATION_ERROR', 'A reason is required', [
      { field: 'reason', message: 'required' },
    ]);
  }
  return trimmed;
}

function assertVersion(doc: WorkflowDoc, expectedVersion: number): void {
  if (doc.version !== expectedVersion) {
    throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
  }
}

function eligibilityStep(step: WorkflowStep): EligibilityStep {
  return {
    cycle: step.cycle,
    stepOrder: step.stepOrder,
    kind: step.kind,
    requiredRoleId: step.requiredRoleId,
    assignedUserId: step.assignedUserId,
  };
}

export class DocumentWorkflowService<D extends WorkflowDoc, S = unknown> {
  private readonly now: () => Date;

  constructor(private readonly deps: DocumentWorkflowDeps<D, S>) {
    this.now = deps.now ?? (() => new Date());
  }

  // -------------------------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------------------------

  /**
   * POST /X/:id/submit (draft or returned → the first step's pending status). The adapter
   * checks the type's submission rules and computes the DoA amount; the route for the new cycle
   * must have an eligible user per step; the adapter places its holds; the number is assigned on
   * the first submission only; the route is materialised, the `submit` action signed and step
   * 1's users notified.
   */
  submit(id: string, input: DocSubmit): Promise<SubmitOutcome<D, S>> {
    const { actor } = this.deps;
    return this.deps.run(async (b) => {
      const { adapter } = b;
      const doc = await this.load(b, id);
      adapter.assertMaySubmit(doc, actor);
      assertVersion(doc, input.expectedVersion);

      const plan = await adapter.prepareSubmit(doc);
      const cycle = doc.submissionCycle + 1;
      const ref = { ...(await this.eligibilityRef(b, doc)), requestingOfficeId: plan.officeId };
      const route = await b.routing.resolveRoute(plan.officeId, plan.doaAmount, adapter.doaType);
      await b.routing.assertRouteEligible(route, ref, cycle);

      await adapter.onSubmit(doc, plan, cycle);

      const number =
        doc.number ??
        (await b.assignNumber(adapter.docType, plan.officeId, plan.submittedAt, plan.timeZone));
      const submitter = await b.actorSnapshot(actor.userId);
      const firstStep = route.steps[0]!;
      const status = adapter.pendingStatus(firstStep);
      const version = await adapter.markSubmitted(doc, plan, {
        number,
        cycle,
        firstStepOrder: firstStep.stepOrder,
        firstStepStatus: status,
        actor: submitter,
      });

      const steps = await b.steps.materialise(id, cycle, route);
      await b.signatures.insert({
        docId: id,
        stepId: null,
        cycle,
        stepOrder: null,
        action: 'submit',
        userName: submitter.nameEn,
        userPosition: submitter.position,
        comment: null,
        payload: adapter.submitPayload?.(doc, plan, number, submitter) ?? {
          number,
          nameAr: submitter.nameAr,
          resubmission: doc.status === 'returned',
        },
      });
      await b.notifier.stepEligible(
        { ...ref, number },
        {
          cycle,
          stepOrder: firstStep.stepOrder,
          kind: firstStep.kind,
          requiredRoleId: firstStep.roleId,
          assignedUserId: null,
        },
        submitter.nameEn
      );
      return { doc, number, version, status, steps, state: plan.state };
    });
  }

  // -------------------------------------------------------------------------------------------
  // Steps
  // -------------------------------------------------------------------------------------------

  /**
   * POST /X/:id/approve — signs the current step. A non-final step advances the route and
   * notifies the next step's users; the final one runs the adapter's approval effects, approves
   * the document and notifies its creator (FR-031, FR-034, FR-036). A suspended or closed grant
   * blocks signing (FR-096); only PAY/DPR pass, with a Finance Manager override and a reason.
   */
  approve(id: string, input: DocApprove): Promise<DocActionResult> {
    return this.deps.run(async (b) => {
      const { adapter } = b;
      const { doc, step, cycleSteps } = await this.openStep(b, id, input);
      await this.assertMayAct(b, doc, step);

      const override = await this.frozenGrantOverride(b, doc, input);
      await adapter.beforeSign?.(doc);

      const signer = await b.actorSnapshot(this.deps.actor.userId);
      const at = this.now().toISOString();
      const comment = input.comment?.trim() || null;
      await b.setAuditComment(override ?? comment);
      await b.signatures.insert({
        docId: id,
        stepId: step.id,
        cycle: step.cycle,
        stepOrder: step.stepOrder,
        action: 'approve',
        userName: signer.nameEn,
        userPosition: signer.position,
        comment,
        payload: {
          nameAr: signer.nameAr,
          kind: step.kind,
          ...(override ? { frozenGrantOverride: override } : {}),
        },
      });
      await b.steps.update(step.id, { status: 'approved', actedAt: at });

      const next = cycleSteps
        .filter((s) => s.stepOrder > step.stepOrder)
        .sort((a, c) => a.stepOrder - c.stepOrder)[0];
      if (next) {
        await b.steps.update(next.id, { status: 'pending' });
        const status = adapter.pendingStatus(next);
        const version = await adapter.setStatus(doc, {
          kind: 'advanced',
          status,
          currentStepOrder: next.stepOrder,
        });
        await b.notifier.stepEligible(adapter.ref(doc), eligibilityStep(next), signer.nameEn);
        return this.result(b, doc, status, version, next.stepOrder);
      }

      await adapter.onApproved(doc);
      const version = await adapter.setStatus(doc, { kind: 'approved', at });
      await b.notifier.creator(adapter.ref(doc), 'approved', signer.nameEn);
      return this.result(b, doc, 'approved', version, null);
    });
  }

  /** POST /X/:id/reject — final: releases the holds and notifies the creator. */
  reject(id: string, input: DocReasonAction): Promise<DocActionResult> {
    return this.close(id, input, 'reject');
  }

  /**
   * POST /X/:id/return — back to the creator for changes; the number stays and the next
   * submission starts a new cycle from step 1 (FR-038).
   */
  return(id: string, input: DocReasonAction): Promise<DocActionResult> {
    return this.close(id, input, 'return');
  }

  private close(
    id: string,
    input: DocReasonAction,
    action: 'reject' | 'return'
  ): Promise<DocActionResult> {
    return this.deps.run(async (b) => {
      const reason = requireReason(input.reason);
      const { adapter } = b;
      const { doc, step } = await this.openStep(b, id, input);
      await this.assertMayAct(b, doc, step);

      const actor = await b.actorSnapshot(this.deps.actor.userId);
      const at = this.now().toISOString();
      const rejected = action === 'reject';
      await b.setAuditComment(reason);
      await b.signatures.insert({
        docId: id,
        stepId: step.id,
        cycle: step.cycle,
        stepOrder: step.stepOrder,
        action,
        userName: actor.nameEn,
        userPosition: actor.position,
        comment: reason,
        payload: { nameAr: actor.nameAr, kind: step.kind },
      });
      await b.steps.update(step.id, { status: rejected ? 'rejected' : 'returned', actedAt: at });
      await b.steps.cancelWaiting(id, step.cycle);
      await adapter.onReleased(doc, rejected ? 'rejected' : 'returned');

      const status = rejected ? 'rejected' : 'returned';
      const version = await adapter.setStatus(doc, {
        kind: status,
        reason,
        by: this.deps.actor.userId,
        at,
      });
      await b.notifier.creator(adapter.ref(doc), status, actor.nameEn);
      return this.result(b, doc, status, version, null);
    });
  }

  /**
   * POST /X/:id/steps/:stepId/reassign — a holder of the type's reassign permission (or
   * settings:manage) assigns an open step of the current cycle to one eligible user (FR-039).
   */
  reassign(id: string, stepId: string, input: DocReassign): Promise<DocActionResult> {
    const { actor } = this.deps;
    return this.deps.run(async (b) => {
      const { adapter } = b;
      if (!adapter.reassignPermissions.some((p) => actor.permissions.has(p))) {
        throw new AppError(
          'FORBIDDEN',
          `Missing permission ${adapter.reassignPermissions.join(' or ')}`
        );
      }
      const reason = requireReason(input.reason);
      const doc = await this.load(b, id);
      assertVersion(doc, input.expectedVersion);
      this.assertPending(b, doc);
      const step = (await b.steps.list(id, doc.submissionCycle)).find((s) => s.id === stepId);
      if (!step || (step.status !== 'pending' && step.status !== 'waiting')) {
        throw new AppError('INVALID_STATE', 'Only an open step of the current cycle is reassigned');
      }
      const eligible = await b.routing.isEligible(
        input.userId,
        { ...eligibilityStep(step), assignedUserId: null },
        await this.eligibilityRef(b, doc)
      );
      if (!eligible) {
        throw new AppError('VALIDATION_ERROR', 'The user is not eligible for this step', [
          { field: 'userId', message: 'not_eligible' },
        ]);
      }

      await b.setAuditComment(reason);
      await b.steps.update(step.id, { assignedUserId: input.userId });
      const version = await adapter.setStatus(doc, { kind: 'touched' });
      const admin = await b.actorSnapshot(actor.userId);
      await b.signatures.insert({
        docId: id,
        stepId: step.id,
        cycle: step.cycle,
        stepOrder: step.stepOrder,
        action: 'reassign',
        userName: admin.nameEn,
        userPosition: admin.position,
        comment: reason,
        payload: { fromUserId: step.assignedUserId, toUserId: input.userId },
      });
      await b.notifier.reassigned(adapter.ref(doc), step, input.userId, admin.nameEn);
      return this.result(b, doc, doc.status, version, doc.currentStepOrder);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Cancel
  // -------------------------------------------------------------------------------------------

  /**
   * POST /X/:id/cancel — releases exactly what the document holds (BR-21), closes its open
   * steps; the number stays used and the creator is told when someone else cancelled.
   */
  cancel(id: string, input: DocCancel): Promise<DocActionResult> {
    const { actor } = this.deps;
    return this.deps.run(async (b) => {
      const reason = requireReason(input.reason);
      const { adapter } = b;
      const doc = await this.load(b, id);
      assertVersion(doc, input.expectedVersion);
      if (!adapter.cancellable(doc.status)) {
        throw new AppError('INVALID_STATE', `A ${doc.status} document cannot be cancelled`);
      }
      if (!adapter.mayCancel(doc, actor)) {
        throw new AppError(
          'FORBIDDEN',
          adapter.cancelForbiddenMessage?.(doc) ?? 'You may not cancel this document'
        );
      }

      const canceller = await b.actorSnapshot(actor.userId);
      const at = this.now().toISOString();
      await b.setAuditComment(reason);
      await b.signatures.insert({
        docId: id,
        stepId: null,
        cycle: Math.max(doc.submissionCycle, 1),
        stepOrder: null,
        action: 'cancel',
        userName: canceller.nameEn,
        userPosition: canceller.position,
        comment: reason,
        payload: { nameAr: canceller.nameAr, fromStatus: doc.status },
      });
      if (doc.submissionCycle > 0) {
        for (const step of await b.steps.list(id, doc.submissionCycle)) {
          if (step.status === 'pending') {
            await b.steps.update(step.id, { status: 'cancelled', actedAt: at });
          }
        }
        await b.steps.cancelWaiting(id, doc.submissionCycle);
      }
      await adapter.onReleased(doc, 'cancelled');

      const version = await adapter.setStatus(doc, {
        kind: 'cancelled',
        reason,
        by: actor.userId,
        at,
      });
      if (adapter.creatorId(doc) !== actor.userId) {
        await b.notifier.creator(adapter.ref(doc), 'cancelled', canceller.nameEn);
      }
      return this.result(b, doc, 'cancelled', version, null);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Read side for detail responses
  // -------------------------------------------------------------------------------------------

  /** GET /X/:id/steps/:stepId/eligible-users — reassignment targets (reassign permission). */
  eligibleUsers(id: string, stepId: string): Promise<DocEligibleUser[]> {
    const { actor } = this.deps;
    return this.deps.run(async (b) => {
      if (!b.adapter.reassignPermissions.some((p) => actor.permissions.has(p))) {
        throw new AppError(
          'FORBIDDEN',
          `Missing permission ${b.adapter.reassignPermissions.join(' or ')}`
        );
      }
      const doc = await this.find(b, id);
      const step = (await b.steps.list(id, doc.submissionCycle)).find((s) => s.id === stepId);
      if (!step) throw new AppError('NOT_FOUND', 'step not found');
      const users = await b.routing.eligibleUsers(
        { ...eligibilityStep(step), assignedUserId: null },
        await this.eligibilityRef(b, doc)
      );
      const result: DocEligibleUser[] = [];
      for (const u of users) {
        const snapshot = await b.actorSnapshot(u.userId);
        result.push({ userId: u.userId, ...snapshot });
      }
      return result;
    });
  }

  /**
   * The current cycle's steps with the caller's possible actions, and the document actions the
   * caller may take (contracts/rest-api.md "availableActions[]").
   */
  describe(id: string): Promise<{ steps: DocStepView[]; availableActions: string[] }> {
    const { actor } = this.deps;
    return this.deps.run(async (b) => {
      const doc = await this.find(b, id);
      return describeFor(b, doc, actor, await b.steps.list(id, doc.submissionCycle));
    });
  }

  // -------------------------------------------------------------------------------------------

  private result(
    b: WorkflowBinding<D, S>,
    doc: D,
    status: string,
    version: number,
    currentStepOrder: number | null
  ): DocActionResult {
    return {
      id: doc.id,
      docType: b.adapter.docType,
      status,
      version,
      number: doc.number,
      currentStepOrder,
    };
  }

  private async load(b: WorkflowBinding<D, S>, id: string): Promise<D> {
    const doc = await b.adapter.load(id, { lock: true });
    if (!doc) throw new AppError('NOT_FOUND', `${b.adapter.docType} document not found`);
    return doc;
  }

  private async find(b: WorkflowBinding<D, S>, id: string): Promise<D> {
    const doc = await b.adapter.load(id, { lock: false });
    if (!doc) throw new AppError('NOT_FOUND', `${b.adapter.docType} document not found`);
    return doc;
  }

  private assertPending(b: WorkflowBinding<D, S>, doc: D): void {
    if (!b.adapter.isPending(doc.status)) {
      throw new AppError('INVALID_STATE', `A ${doc.status} document has no open step`);
    }
  }

  /** The locked document and its current pending step, which `input.stepId` must name. */
  private async openStep(
    b: WorkflowBinding<D, S>,
    id: string,
    input: { expectedVersion: number; stepId: string }
  ) {
    const doc = await this.load(b, id);
    assertVersion(doc, input.expectedVersion);
    this.assertPending(b, doc);
    const cycleSteps = await b.steps.list(id, doc.submissionCycle);
    const step = cycleSteps.find((s) => s.id === input.stepId);
    if (!step || step.status !== 'pending' || step.stepOrder !== doc.currentStepOrder) {
      throw new AppError('INVALID_STATE', 'The step is not the current step of the document');
    }
    return { doc, step, cycleSteps };
  }

  private async eligibilityRef(b: WorkflowBinding<D, S>, doc: D) {
    const ref = b.adapter.ref(doc);
    const facts = await b.adapter.segregationFacts?.(doc);
    if (!facts) return ref;
    return {
      ...ref,
      doc: {
        docType: b.adapter.docType,
        doaType: b.adapter.doaType,
        segregation: facts,
      },
    };
  }

  /**
   * Segregation of duties first (403 SEGREGATION_OF_DUTIES with the rule id, BR-8), then
   * eligibility for the step (403 FORBIDDEN).
   */
  private async assertMayAct(b: WorkflowBinding<D, S>, doc: D, step: WorkflowStep): Promise<void> {
    const { userId } = this.deps.actor;
    const { adapter } = b;
    const facts = (await adapter.segregationFacts?.(doc)) ?? {};
    assertCanSign(
      { ...facts, docType: adapter.docType, creatorId: adapter.creatorId(doc) },
      userId,
      { kind: 'step', stepKind: step.kind, stepOrder: step.stepOrder, cycle: step.cycle },
      await b.signatures.list(doc.id),
      adapter.segregationMessages
    );
    const ref = await this.eligibilityRef(b, doc);
    if (!(await b.routing.isEligible(userId, eligibilityStep(step), ref))) {
      throw new AppError('FORBIDDEN', 'You are not eligible for this step');
    }
  }

  /** The override reason when a frozen grant is passed for PAY/DPR; null when not frozen. */
  private async frozenGrantOverride(
    b: WorkflowBinding<D, S>,
    doc: D,
    input: DocApprove
  ): Promise<string | null> {
    const { adapter } = b;
    if (!adapter.grantFrozen || !(await adapter.grantFrozen(doc))) return null;
    const reason = input.frozenGrantOverrideReason?.trim();
    if (
      adapter.frozenGrantOverride &&
      reason &&
      this.deps.actor.permissions.has(PERMISSIONS_002.PAYMENT_OVERRIDE_MATCH)
    ) {
      return reason;
    }
    throw new AppError('GRANT_NOT_ACTIVE', 'The grant is suspended or closed');
  }
}

/** Per-step canApprove/canReject/canReturn and the document actions for `actor`. */
export async function describeFor<D extends WorkflowDoc, S>(
  b: WorkflowBinding<D, S>,
  doc: D,
  actor: WorkflowActor,
  steps: WorkflowStep[]
): Promise<{ steps: DocStepView[]; availableActions: string[] }> {
  const adapter: DocAdapter<D, S> = b.adapter;
  const ref = adapter.ref(doc);
  const facts = (await adapter.segregationFacts?.(doc)) ?? undefined;
  const eligibility = facts
    ? { ...ref, doc: { docType: adapter.docType, doaType: adapter.doaType, segregation: facts } }
    : ref;
  const pending = adapter.isPending(doc.status);

  const views: DocStepView[] = [];
  let canActOnCurrent = false;
  for (const s of steps) {
    const current = pending && s.status === 'pending' && s.stepOrder === doc.currentStepOrder;
    const may =
      current && (await b.routing.isEligible(actor.userId, eligibilityStep(s), eligibility));
    if (may) canActOnCurrent = true;
    views.push({
      id: s.id,
      cycle: s.cycle,
      stepOrder: s.stepOrder,
      kind: s.kind,
      requiredRoleId: s.requiredRoleId,
      roleNameAr: s.roleNameAr ?? '',
      roleNameEn: s.roleNameEn ?? '',
      assignedUserId: s.assignedUserId,
      status: s.status as DocStepView['status'],
      actedAt: s.actedAt ?? null,
      canApprove: may,
      canReject: may,
      canReturn: may,
    });
  }

  const actions: string[] = [];
  const creator = adapter.creatorId(doc) === actor.userId;
  if ((doc.status === 'draft' || doc.status === 'returned') && creator) actions.push('submit');
  if (canActOnCurrent) actions.push('approve', 'reject', 'return');
  if (adapter.cancellable(doc.status) && adapter.mayCancel(doc, actor)) actions.push('cancel');
  if (pending && adapter.reassignPermissions.some((p) => actor.permissions.has(p))) {
    actions.push('reassign');
  }
  return { steps: views, availableActions: actions };
}
