// PR state transitions (data-model §6). Submit, approve, reject, return, reassign and cancel run
// through the generic document engine (document-workflow.service.ts) with the PR adapter
// (doc-adapters/pr.adapter.ts), which keeps every 001 rule; each command is one tenant
// transaction that locks the PR and then its budget lines in ascending id order (research R4).
// Changing a line's budget line during the finance check is PR-only and stays here (US5-4).
import {
  parseAmount,
  type PrActionResult,
  type PrApprove,
  type PrCancel,
  type PrChangeBudgetLine,
  type PrReasonAction,
  type PrReassign,
  type PrSubmit,
  type PrSubmitResult,
  type StepKind,
} from '@ngo/shared';
import { withTenantTx, type TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import { NotificationRepository } from '../repositories/notification.repository';
import { NumberingRepository } from '../repositories/numbering.repository';
import type { PrRecord } from '../repositories/pr.repository';
import type { RequestContext } from '../types/context';
import { BudgetService } from './budget.service';
import {
  prBinding,
  prRef,
  type PrSubmitState,
  type PrWorkflowRepos,
} from './doc-adapters/pr.adapter';
import { DocumentWorkflowService } from './document-workflow.service';
import { ExchangeRateService } from './exchange-rate.service';
import { NotificationService } from './notification.service';
import { NumberingService, numberingTxStore } from './numbering.service';
import { actorOf, assertVersion, getPr, prRepos, type PrActor } from './pr.service';
import { assertCanSign } from './segregation.service';

export type { PrWorkflowRepos };

export interface PrWorkflowDeps {
  actor: PrActor;
  run<T>(fn: (repos: PrWorkflowRepos, tx: TenantTx) => Promise<T>): Promise<T>;
  budget: BudgetService;
  rates: ExchangeRateService;
  numbering: NumberingService;
  now?: () => Date;
}

function actionResult(r: {
  id: string;
  status: string;
  version: number;
  currentStepOrder: number | null;
}): PrActionResult {
  return {
    id: r.id,
    status: r.status as PrActionResult['status'],
    version: r.version,
    currentStepOrder: r.currentStepOrder,
  };
}

export class PrWorkflowService {
  private readonly now: () => Date;
  private readonly engine: DocumentWorkflowService<PrRecord, PrSubmitState>;

  constructor(private readonly deps: PrWorkflowDeps) {
    this.now = deps.now ?? (() => new Date());
    this.engine = new DocumentWorkflowService({
      actor: deps.actor,
      now: this.now,
      run: (fn) =>
        deps.run((repos, tx) =>
          fn(
            prBinding(repos, tx, {
              actor: deps.actor,
              budget: deps.budget,
              rates: deps.rates,
              numbering: deps.numbering,
              now: this.now,
            }),
            tx
          )
        ),
    });
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
  async submit(id: string, input: PrSubmit): Promise<PrSubmitResult> {
    const outcome = await this.engine.submit(id, input);
    const { grant, reservations } = outcome.state;
    return {
      id,
      status: 'pending_finance_check',
      number: outcome.number,
      version: outcome.version,
      steps: outcome.steps.map((s) => ({
        stepOrder: s.stepOrder,
        // a PR route has only PR kinds
        kind: s.kind as StepKind,
        status: s.status,
      })),
      reservations: reservations.map((r) => ({
        budgetLineId: r.budgetLineId,
        amount: parseAmount(r.amount).toFixed(2),
        currency: grant.currency,
      })),
    };
  }

  /**
   * POST /prs/:id/approve — signs the current step. A non-final step advances the route and
   * notifies the next step's users; the final one commits the cycle's reservations, approves the
   * PR and notifies the requester (FR-031, FR-034, FR-036, Business Rules 5–6).
   */
  async approve(id: string, input: PrApprove): Promise<PrActionResult> {
    return actionResult(await this.engine.approve(id, input));
  }

  /** POST /prs/:id/reject — final: releases the holds and notifies the requester. */
  async reject(id: string, input: PrReasonAction): Promise<PrActionResult> {
    return actionResult(await this.engine.reject(id, input));
  }

  /**
   * POST /prs/:id/return — back to the requester for changes; the number stays and the next
   * submission starts a new cycle from step 1 with fresh rates and a fresh reservation (FR-038).
   */
  async return(id: string, input: PrReasonAction): Promise<PrActionResult> {
    return actionResult(await this.engine.return(id, input));
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
  async reassign(id: string, stepId: string, input: PrReassign): Promise<PrActionResult> {
    return actionResult(await this.engine.reassign(id, stepId, input));
  }

  /**
   * POST /prs/:id/cancel — the creator cancels a pending or returned PR; a holder of
   * pr:cancel_approved cancels any pending, returned or approved one. Every open hold is
   * released as `cancelled`, open steps close, the number stays used and the requester is told
   * when someone else cancelled (US6-1, US6-2, FR-041, FR-042).
   */
  async cancel(id: string, input: PrCancel): Promise<PrActionResult> {
    return actionResult(await this.engine.cancel(id, input));
  }

  // -------------------------------------------------------------------------------------------

  /**
   * Segregation of duties first — the requester, or a user who signed another step of this PR
   * in any cycle → 403 SEGREGATION_OF_DUTIES (Business Rules 5–6, FR-032) — then eligibility
   * for the step → 403 FORBIDDEN. The rules themselves live in segregation.service.
   */
  private async assertMayAct(
    repos: PrWorkflowRepos,
    pr: PrRecord,
    step: {
      cycle: number;
      stepOrder: number;
      kind: StepKind;
      requiredRoleId: string;
      assignedUserId: string | null;
    }
  ): Promise<void> {
    const { userId } = this.deps.actor;
    assertCanSign(
      { docType: 'PR', creatorId: pr.requesterId },
      userId,
      { kind: 'step', stepKind: step.kind, stepOrder: step.stepOrder, cycle: step.cycle },
      await repos.actions.list(pr.id),
      {
        creator_approves: 'The requester cannot act on their own purchase requisition',
        same_user_two_steps:
          'A user who signed one step cannot sign another step of the same requisition',
      }
    );
    if (!(await repos.routing.isEligible(userId, step, prRef(pr)))) {
      throw new AppError('FORBIDDEN', 'You are not eligible for this step');
    }
  }
}
