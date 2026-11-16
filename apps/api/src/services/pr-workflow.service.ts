// PR state transitions (data-model §6). Each command runs in one tenant transaction that locks
// the PR and then its budget lines in ascending id order, so the budget check, numbering,
// reservation, signatures and notifications commit together or not at all (research R4).
// US4: submit. US5: approve, reject, return, change budget line and reassign. US6 adds cancel.
import {
  DEFAULT_MINOR_UNITS,
  Decimal,
  PERMISSIONS,
  addDays,
  calendarDateInTimeZone,
  canTransition,
  convertLine,
  isPending,
  parseAmount,
  type PrActionResult,
  type PrApprove,
  type PrCancel,
  type PrChangeBudgetLine,
  type PrReasonAction,
  type PrReassign,
  type PrSubmit,
  type PrSubmitResult,
  type ResolvedRate,
} from '@ngo/shared';
import { withTenantTx, type TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import { NotificationRepository } from '../repositories/notification.repository';
import { NumberingRepository } from '../repositories/numbering.repository';
import type { PrStepRecord } from '../repositories/pr-approval-step.repository';
import type { PrLineRecord, PrRecord } from '../repositories/pr.repository';
import type { RequestContext } from '../types/context';
import type { EligibilityStep } from './approval-routing.service';
import { BudgetService, type LineAmount } from './budget.service';
import { ExchangeRateService } from './exchange-rate.service';
import { assertGrantSelectableForPr, grantPrMismatch } from './grant.service';
import { NotificationService } from './notification.service';
import { NumberingService, numberingTxStore } from './numbering.service';
import {
  actorOf,
  assertCreator,
  assertEditable,
  assertGrantLinks,
  assertVersion,
  getPr,
  mayCancel,
  prRepos,
  type PrActor,
  type PrRepos,
} from './pr.service';

export interface PrWorkflowRepos extends PrRepos {
  notifications: NotificationService;
}

export interface PrWorkflowDeps {
  actor: PrActor;
  run<T>(fn: (repos: PrWorkflowRepos, tx: TenantTx) => Promise<T>): Promise<T>;
  budget: BudgetService;
  rates: ExchangeRateService;
  numbering: NumberingService;
  now?: () => Date;
}

/** A line that passed the completeness check. */
interface CompleteLine extends PrLineRecord {
  lineTotal: string;
  budgetLineId: string;
}

const REQUIRED_HEADER = [
  'prDate',
  'requestingOfficeId',
  'grantId',
  'deliverToOfficeId',
  'prType',
] as const satisfies readonly (keyof PrRecord)[];

const REQUIRED_LINE = [
  'description',
  'quantity',
  'unitId',
  'unitCost',
  'budgetLineId',
  'locationOfficeId',
] as const satisfies readonly (keyof PrLineRecord)[];

/** 400 VALIDATION_ERROR naming every missing header and line field. */
function assertComplete(
  pr: PrRecord,
  lines: readonly PrLineRecord[]
): asserts lines is CompleteLine[] {
  const errors: { field: string; message: string }[] = [];
  for (const field of REQUIRED_HEADER) {
    if (pr[field] === null) errors.push({ field: `header.${field}`, message: 'required' });
  }
  lines.forEach((line, i) => {
    for (const field of REQUIRED_LINE) {
      const value = line[field];
      if (value === null || (typeof value === 'string' && value.trim() === '')) {
        errors.push({ field: `lines.${i}.${field}`, message: 'required' });
      }
    }
  });
  if (errors.length) {
    throw new AppError('VALIDATION_ERROR', 'The purchase requisition is incomplete', errors);
  }
}

const fixed2 = (d: Decimal) => d.toFixed(2);

function assertPending(pr: PrRecord): void {
  if (!isPending(pr.status)) {
    throw new AppError('INVALID_STATE', `A ${pr.status} purchase requisition has no open step`);
  }
}

/** The PR as eligibility checks and notifications see it (submitted: office is set). */
function prRef(pr: PrRecord) {
  return {
    id: pr.id,
    requesterId: pr.requesterId,
    requestingOfficeId: pr.requestingOfficeId!,
    number: pr.number,
  };
}

function eligibilityStep(step: PrStepRecord): EligibilityStep {
  return {
    cycle: step.cycle,
    stepOrder: step.stepOrder,
    kind: step.kind,
    requiredRoleId: step.requiredRoleId,
    assignedUserId: step.assignedUserId,
  };
}

export class PrWorkflowService {
  private readonly now: () => Date;

  constructor(private readonly deps: PrWorkflowDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  static forContext(ctx: RequestContext): PrWorkflowService {
    return new PrWorkflowService({
      actor: actorOf(ctx),
      run: (fn) =>
        withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, (tx) => {
          const repos = prRepos(tx, ctx.tenantId);
          return fn(
            {
              ...repos,
              notifications: new NotificationService(
                new NotificationRepository(tx.sql, ctx.tenantId),
                repos.routing
              ),
            },
            tx
          );
        }),
      budget: BudgetService.forContext(ctx),
      rates: ExchangeRateService.forContext(ctx),
      numbering: new NumberingService(new NumberingRepository(ctx), numberingTxStore(ctx.tenantId)),
    });
  }

  /**
   * POST /prs/:id/submit (draft or returned → pending_finance_check). Checks every submission
   * rule, locks the rates, assigns the number on the first submission, materialises the
   * approval route for the new cycle, reserves the budget, freezes the print labels, signs the
   * `submit` action and notifies the users who can perform step 1.
   */
  submit(id: string, input: PrSubmit): Promise<PrSubmitResult> {
    const { actor, budget, rates, numbering } = this.deps;
    return this.deps.run(async (repos, tx) => {
      const { prs } = repos;
      const pr = await getPr(prs, id, { lock: true });
      assertCreator(pr, actor);
      assertEditable(pr);
      assertVersion(pr, input.expectedVersion);

      // --- the document itself ----------------------------------------------------------------
      const lines = await prs.lines(id);
      if (lines.length === 0) {
        throw new AppError('PR_EMPTY', 'The purchase requisition has no lines');
      }
      assertComplete(pr, lines);
      const prDate = pr.prDate!;
      const officeId = pr.requestingOfficeId!;
      const grantId = pr.grantId!;
      if (lines.every((l) => parseAmount(l.lineTotal).isZero())) {
        throw new AppError('PR_EMPTY', 'The purchase requisition total is zero');
      }
      if (pr.requiredByDate !== null && pr.requiredByDate < prDate) {
        throw new AppError(
          'REQUIRED_BY_BEFORE_PR_DATE',
          'The required-by date is before the PR date'
        );
      }

      const settings = await prs.settings();
      const submittedAt = this.now();
      const latest = calendarDateInTimeZone(submittedAt, settings.timeZone);
      const earliest = addDays(latest, -settings.maxBackdateDays);
      if (prDate > latest || prDate < earliest) {
        throw new AppError('PR_DATE_OUT_OF_RANGE', 'The PR date is outside the allowed range', {
          prDate,
          earliest,
          latest,
        });
      }

      // --- funding --------------------------------------------------------------------------
      const grant = await prs.grant(grantId);
      if (!grant) throw new AppError('NOT_FOUND', 'grant not found');
      assertGrantSelectableForPr(grant, { prDate, officeId });
      await assertGrantLinks(prs, grantId, pr, lines);

      // --- rates and amounts (Business Rule 11, research R7) ----------------------------------
      const doaCurrency = settings.doaReferenceCurrency;
      const resolved = await rates.resolveRates(
        tx,
        [...lines.map((l) => l.currency), grant.currency, doaCurrency],
        prDate
      );
      const rate = (currency: string): ResolvedRate => resolved.get(currency)!;
      const units = await prs.minorUnits([grant.currency, doaCurrency]);
      const grantUnits = units.get(grant.currency) ?? DEFAULT_MINOR_UNITS;
      const doaUnits = units.get(doaCurrency) ?? DEFAULT_MINOR_UNITS;

      let totalGrant = new Decimal(0);
      let doaAmount = new Decimal(0);
      const locked = lines.map((line) => {
        const lineRate = rate(line.currency);
        const amountGrant = convertLine(
          line.lineTotal,
          lineRate.rateToBase,
          rate(grant.currency).rateToBase,
          grantUnits
        );
        totalGrant = totalGrant.plus(amountGrant);
        doaAmount = doaAmount.plus(
          convertLine(line.lineTotal, lineRate.rateToBase, rate(doaCurrency).rateToBase, doaUnits)
        );
        return { line, rate: lineRate, amountGrant };
      });

      // --- route (FR-019, FR-020) -------------------------------------------------------------
      const cycle = pr.submissionCycle + 1;
      const eligibilityPr = { id, requesterId: pr.requesterId, requestingOfficeId: officeId };
      const route = await repos.routing.resolveRoute(officeId, doaAmount.toFixed(doaUnits));
      await repos.routing.assertRouteEligible(route, eligibilityPr, cycle);

      // --- budget (Business Rule 3, FR-037): locks the lines, then holds the amounts -----------
      const amounts: LineAmount[] = locked.map((l) => ({
        budgetLineId: l.line.budgetLineId,
        amount: l.amountGrant,
        prLineIds: [l.line.id],
      }));
      const reservations = await budget.reserve(tx, id, cycle, amounts);

      // --- number (first submission only; year of the submission date, FR-004) -------------
      const number =
        pr.number ??
        (await numbering.assignNumber(tx.sql, 'PR', officeId, submittedAt, settings.timeZone));

      // --- writes ---------------------------------------------------------------------------
      for (const l of locked) {
        await prs.lockLine(l.line.id, {
          rateToBase: l.rate.rateToBase,
          rateDate: l.rate.rateDate,
          rateSource: l.rate.source,
          exchangeRateId: l.rate.exchangeRateId,
          amountGrant: l.amountGrant,
        });
      }
      const requester = await prs.actor(actor.userId);
      const grantRate = rate(grant.currency);
      const doaRate = rate(doaCurrency);
      const firstStep = route.steps[0]!;
      const version = await prs.markSubmitted(id, {
        number,
        submissionCycle: cycle,
        currentStepOrder: firstStep.stepOrder,
        submittedAt: submittedAt.toISOString(),
        requesterName: requester.nameEn,
        requesterPosition: requester.position,
        doaCurrency,
        doaAmount: doaAmount.toFixed(doaUnits),
        doaRateToBase: doaRate.rateToBase,
        doaRateDate: doaRate.rateDate,
        doaRateSource: doaRate.source,
        doaExchangeRateId: doaRate.exchangeRateId,
        grantRateToBase: grantRate.rateToBase,
        grantRateDate: grantRate.rateDate,
        grantRateSource: grantRate.source,
        grantExchangeRateId: grantRate.exchangeRateId,
        totalGrantCurrency: totalGrant.toFixed(grantUnits),
        printSnapshot: await prs.printSnapshot(id),
      });

      const steps = await repos.routing.materialiseSteps(tx.sql, { id }, cycle, route);
      await repos.actions.insert({
        prId: id,
        stepId: null,
        cycle,
        stepOrder: null,
        action: 'submit',
        userName: requester.nameEn,
        userPosition: requester.position,
        comment: null,
        payload: { number, nameAr: requester.nameAr, resubmission: pr.status === 'returned' },
      });
      await repos.notifications.notifyStepEligible(
        { ...eligibilityPr, number },
        {
          cycle,
          stepOrder: firstStep.stepOrder,
          kind: firstStep.kind,
          requiredRoleId: firstStep.roleId,
          assignedUserId: null,
        },
        requester.nameEn
      );

      return {
        id,
        status: 'pending_finance_check',
        number,
        version,
        steps: steps.map((s) => ({ stepOrder: s.stepOrder, kind: s.kind, status: s.status })),
        reservations: reservations.map((r) => ({
          budgetLineId: r.budgetLineId,
          amount: fixed2(parseAmount(r.amount)),
          currency: grant.currency,
        })),
      };
    });
  }
  // -------------------------------------------------------------------------------------------
  // Steps (US5)
  // -------------------------------------------------------------------------------------------

  /**
   * POST /prs/:id/approve — signs the current step. A non-final step advances the route and
   * notifies the next step's users; the final one commits the cycle's reservations, approves the
   * PR and notifies the requester (FR-031, FR-034, FR-036, Business Rules 5–6).
   */
  approve(id: string, input: PrApprove): Promise<PrActionResult> {
    const { budget } = this.deps;
    return this.deps.run(async (repos, tx) => {
      const { prs, steps } = repos;
      const { pr, step, cycleSteps } = await this.openStep(repos, id, input);
      await this.assertMayAct(repos, pr, step);

      // a frozen grant blocks signing (FR-022) and its period must still cover the PR date
      // (FR-034); return, reject and cancel stay allowed
      const grant = await prs.grant(pr.grantId!);
      if (!grant) throw new AppError('NOT_FOUND', 'grant not found');
      const mismatch = grantPrMismatch(grant, {
        prDate: pr.prDate!,
        officeId: pr.requestingOfficeId!,
      });
      if (mismatch === 'GRANT_NOT_ACTIVE') {
        throw new AppError(mismatch, 'The grant is suspended or closed');
      }
      if (mismatch === 'GRANT_PERIOD_MISMATCH') {
        throw new AppError(mismatch, 'The PR date is outside the grant period');
      }

      const signer = await prs.actor(this.deps.actor.userId);
      const now = this.now().toISOString();
      const comment = input.comment?.trim() || null;
      await tx.setAuditComment(comment);
      await repos.actions.insert({
        prId: id,
        stepId: step.id,
        cycle: step.cycle,
        stepOrder: step.stepOrder,
        action: 'approve',
        userName: signer.nameEn,
        userPosition: signer.position,
        comment,
        payload: { nameAr: signer.nameAr, kind: step.kind },
      });
      await steps.update(step.id, { status: 'approved', actedAt: now });

      const next = cycleSteps
        .filter((s) => s.stepOrder > step.stepOrder)
        .sort((a, b) => a.stepOrder - b.stepOrder)[0];
      if (next) {
        await steps.update(next.id, { status: 'pending' });
        const version = await prs.updateStatus(id, {
          status: 'pending_approval',
          currentStepOrder: next.stepOrder,
        });
        await repos.notifications.notifyStepEligible(
          prRef(pr),
          eligibilityStep(next),
          signer.nameEn
        );
        return { id, status: 'pending_approval', version, currentStepOrder: next.stepOrder };
      }

      await budget.commit(tx, id, pr.submissionCycle);
      const version = await prs.updateStatus(id, {
        status: 'approved',
        approvedAt: now,
        currentStepOrder: null,
      });
      await repos.notifications.notifyRequester(prRef(pr), 'pr_approved', signer.nameEn);
      return { id, status: 'approved', version, currentStepOrder: null };
    });
  }

  /** POST /prs/:id/reject — final: releases the holds and notifies the requester. */
  reject(id: string, input: PrReasonAction): Promise<PrActionResult> {
    return this.close(id, input, 'reject');
  }

  /**
   * POST /prs/:id/return — back to the requester for changes; the number stays and the next
   * submission starts a new cycle from step 1 with fresh rates and a fresh reservation (FR-038).
   */
  return(id: string, input: PrReasonAction): Promise<PrActionResult> {
    return this.close(id, input, 'return');
  }

  private close(
    id: string,
    input: PrReasonAction,
    action: 'reject' | 'return'
  ): Promise<PrActionResult> {
    const { budget } = this.deps;
    return this.deps.run(async (repos, tx) => {
      const { prs, steps } = repos;
      const reason = input.reason?.trim() ?? '';
      if (!reason) {
        throw new AppError('VALIDATION_ERROR', 'A reason is required', [
          { field: 'reason', message: 'required' },
        ]);
      }
      const { pr, step } = await this.openStep(repos, id, input);
      await this.assertMayAct(repos, pr, step);

      const actor = await prs.actor(this.deps.actor.userId);
      const now = this.now().toISOString();
      const rejected = action === 'reject';
      await tx.setAuditComment(reason);
      await repos.actions.insert({
        prId: id,
        stepId: step.id,
        cycle: step.cycle,
        stepOrder: step.stepOrder,
        action,
        userName: actor.nameEn,
        userPosition: actor.position,
        comment: reason,
        payload: { nameAr: actor.nameAr, kind: step.kind },
      });
      await steps.update(step.id, { status: rejected ? 'rejected' : 'returned', actedAt: now });
      await steps.cancelWaiting(id, step.cycle);
      await budget.release(tx, id, rejected ? 'rejected' : 'returned');

      const status = rejected ? 'rejected' : 'returned';
      const version = await prs.updateStatus(
        id,
        rejected
          ? {
              status,
              currentStepOrder: null,
              rejectReason: reason,
              rejectedBy: this.deps.actor.userId,
              closedAt: now,
            }
          : { status, currentStepOrder: null, returnReason: reason }
      );
      await repos.notifications.notifyRequester(
        prRef(pr),
        rejected ? 'pr_rejected' : 'pr_returned',
        actor.nameEn
      );
      return { id, status, version, currentStepOrder: null };
    });
  }

  /**
   * POST /prs/:id/lines/:lineId/budget-line — during the finance check the checker moves a line
   * to another budget line of the same grant; the line's reservation moves with it after the
   * target is re-checked without this PR's own holds (US5-4, FR-033).
   */
  changeBudgetLine(id: string, lineId: string, input: PrChangeBudgetLine): Promise<PrActionResult> {
    const { budget } = this.deps;
    return this.deps.run(async (repos, tx) => {
      const { prs } = repos;
      const pr = await getPr(prs, id, { lock: true });
      assertVersion(pr, input.expectedVersion);
      if (pr.status !== 'pending_finance_check') {
        throw new AppError('INVALID_STATE', 'Budget lines change only during the finance check');
      }
      const step = (await repos.steps.list(id, pr.submissionCycle)).find(
        (s) => s.status === 'pending' && s.kind === 'finance_check'
      );
      if (!step) throw new AppError('INVALID_STATE', 'The finance check is not open');
      await this.assertMayAct(repos, pr, step);

      const line = (await prs.lines(id)).find((l) => l.id === lineId);
      if (!line) throw new AppError('NOT_FOUND', 'pr_line not found');
      const targetGrant = (await prs.budgetLineGrants([input.budgetLineId])).get(
        input.budgetLineId
      );
      if (targetGrant === undefined) throw new AppError('NOT_FOUND', 'budget_line not found');
      if (targetGrant !== pr.grantId) {
        throw new AppError(
          'PR_LINE_GRANT_MISMATCH',
          'The budget line must belong to the grant of the purchase requisition'
        );
      }
      const fromBudgetLineId = line.budgetLineId!;
      const unchanged = {
        id,
        status: pr.status,
        version: pr.version,
        currentStepOrder: pr.currentStepOrder,
      };
      if (fromBudgetLineId === input.budgetLineId) return unchanged;

      await budget.moveReservation(
        tx,
        id,
        pr.submissionCycle,
        fromBudgetLineId,
        input.budgetLineId,
        line.amountGrant ?? '0'
      );
      const comment = input.comment?.trim() || null;
      await tx.setAuditComment(comment);
      const version = await prs.setLineBudgetLine(id, lineId, input.budgetLineId);
      const actor = await prs.actor(this.deps.actor.userId);
      await repos.actions.insert({
        prId: id,
        stepId: step.id,
        cycle: step.cycle,
        stepOrder: step.stepOrder,
        action: 'change_budget_line',
        userName: actor.nameEn,
        userPosition: actor.position,
        comment,
        payload: { lineId, fromBudgetLineId, toBudgetLineId: input.budgetLineId },
      });
      return { ...unchanged, version };
    });
  }

  /**
   * POST /prs/:id/steps/:stepId/reassign — an administrator (pr:reassign) assigns an open step
   * of the current cycle to one eligible user, who is notified (US5-6, FR-039).
   */
  reassign(id: string, stepId: string, input: PrReassign): Promise<PrActionResult> {
    const { actor } = this.deps;
    return this.deps.run(async (repos, tx) => {
      if (!actor.permissions.has(PERMISSIONS.PR_REASSIGN)) {
        throw new AppError('FORBIDDEN', 'Missing permission pr:reassign');
      }
      const reason = input.reason?.trim() ?? '';
      if (!reason) {
        throw new AppError('VALIDATION_ERROR', 'A reason is required', [
          { field: 'reason', message: 'required' },
        ]);
      }
      const { prs, steps } = repos;
      const pr = await getPr(prs, id, { lock: true });
      assertVersion(pr, input.expectedVersion);
      assertPending(pr);
      const step = (await steps.list(id, pr.submissionCycle)).find((s) => s.id === stepId);
      if (!step || (step.status !== 'pending' && step.status !== 'waiting')) {
        throw new AppError('INVALID_STATE', 'Only an open step of the current cycle is reassigned');
      }
      const eligible = await repos.routing.isEligible(
        input.userId,
        { ...eligibilityStep(step), assignedUserId: null },
        prRef(pr)
      );
      if (!eligible) {
        throw new AppError('VALIDATION_ERROR', 'The user is not eligible for this step', [
          { field: 'userId', message: 'not_eligible' },
        ]);
      }

      await tx.setAuditComment(reason);
      await steps.update(step.id, { assignedUserId: input.userId });
      const version = await prs.updateStatus(id, {});
      const admin = await prs.actor(actor.userId);
      await repos.actions.insert({
        prId: id,
        stepId: step.id,
        cycle: step.cycle,
        stepOrder: step.stepOrder,
        action: 'reassign',
        userName: admin.nameEn,
        userPosition: admin.position,
        comment: reason,
        payload: { fromUserId: step.assignedUserId, toUserId: input.userId },
      });
      await repos.notifications.notifyReassigned(prRef(pr), step, input.userId, admin.nameEn);
      return { id, status: pr.status, version, currentStepOrder: pr.currentStepOrder };
    });
  }

  // -------------------------------------------------------------------------------------------
  // Cancel (US6)
  // -------------------------------------------------------------------------------------------

  /**
   * POST /prs/:id/cancel — the creator cancels a pending or returned PR; a holder of
   * pr:cancel_approved cancels any pending, returned or approved one. Every open hold is
   * released as `cancelled`, open steps close, the number stays used and the requester is told
   * when someone else cancelled (US6-1, US6-2, FR-041, FR-042).
   */
  cancel(id: string, input: PrCancel): Promise<PrActionResult> {
    const { actor, budget } = this.deps;
    return this.deps.run(async (repos, tx) => {
      const reason = input.reason?.trim() ?? '';
      if (!reason) {
        throw new AppError('VALIDATION_ERROR', 'A reason is required', [
          { field: 'reason', message: 'required' },
        ]);
      }
      const { prs, steps } = repos;
      const pr = await getPr(prs, id, { lock: true });
      assertVersion(pr, input.expectedVersion);
      if (!canTransition(pr.status, 'cancel')) {
        throw new AppError(
          'INVALID_STATE',
          `A ${pr.status} purchase requisition cannot be cancelled`
        );
      }
      if (!mayCancel(pr, actor)) {
        throw new AppError(
          'FORBIDDEN',
          pr.status === 'approved'
            ? 'Missing permission pr:cancel_approved'
            : 'Only the requester can cancel this purchase requisition'
        );
      }

      const canceller = await prs.actor(actor.userId);
      const now = this.now().toISOString();
      await tx.setAuditComment(reason);
      await repos.actions.insert({
        prId: id,
        stepId: null,
        cycle: pr.submissionCycle,
        stepOrder: null,
        action: 'cancel',
        userName: canceller.nameEn,
        userPosition: canceller.position,
        comment: reason,
        payload: { nameAr: canceller.nameAr, fromStatus: pr.status },
      });
      for (const step of await steps.list(id, pr.submissionCycle)) {
        if (step.status === 'pending') {
          await steps.update(step.id, { status: 'cancelled', actedAt: now });
        }
      }
      await steps.cancelWaiting(id, pr.submissionCycle);
      await budget.release(tx, id, 'cancelled');

      const version = await prs.updateStatus(id, {
        status: 'cancelled',
        currentStepOrder: null,
        cancelReason: reason,
        cancelledBy: actor.userId,
        closedAt: now,
      });
      if (pr.requesterId !== actor.userId) {
        await repos.notifications.notifyRequester(prRef(pr), 'pr_cancelled', canceller.nameEn);
      }
      return { id, status: 'cancelled', version, currentStepOrder: null };
    });
  }

  // -------------------------------------------------------------------------------------------

  /** The locked PR and its current pending step, which `input.stepId` must name. */
  private async openStep(
    repos: PrWorkflowRepos,
    id: string,
    input: { expectedVersion: number; stepId: string }
  ) {
    const pr = await getPr(repos.prs, id, { lock: true });
    assertVersion(pr, input.expectedVersion);
    assertPending(pr);
    const cycleSteps = await repos.steps.list(id, pr.submissionCycle);
    const step = cycleSteps.find((s) => s.id === input.stepId);
    if (!step || step.status !== 'pending' || step.stepOrder !== pr.currentStepOrder) {
      throw new AppError('INVALID_STATE', 'The step is not the current step of the requisition');
    }
    return { pr, step, cycleSteps };
  }

  /**
   * Segregation of duties first — the requester, or a user who signed another step of this PR
   * in any cycle → 403 SEGREGATION_OF_DUTIES (Business Rules 5–6, FR-032) — then eligibility
   * for the step → 403 FORBIDDEN.
   */
  private async assertMayAct(
    repos: PrWorkflowRepos,
    pr: PrRecord,
    step: PrStepRecord
  ): Promise<void> {
    const { userId } = this.deps.actor;
    if (pr.requesterId === userId) {
      throw new AppError(
        'SEGREGATION_OF_DUTIES',
        'The requester cannot act on their own purchase requisition'
      );
    }
    const signedOther = (await repos.actions.list(pr.id)).some(
      (a) =>
        a.userId === userId &&
        a.action === 'approve' &&
        (a.stepOrder !== step.stepOrder || a.cycle === step.cycle)
    );
    if (signedOther) {
      throw new AppError(
        'SEGREGATION_OF_DUTIES',
        'A user who signed one step cannot sign another step of the same requisition'
      );
    }
    if (!(await repos.routing.isEligible(userId, eligibilityStep(step), prRef(pr)))) {
      throw new AppError('FORBIDDEN', 'You are not eligible for this step');
    }
  }
}
