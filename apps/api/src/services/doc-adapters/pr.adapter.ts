// The purchase requisition as a document-workflow type (research D1). Everything PR-specific
// that 001's pr-workflow.service did lives here unchanged — completeness, dates, grant links,
// locked rates and amounts (Business Rule 11, R7), budget reservation and commitment, the PR
// status columns and PR notification kinds — so the 001 routes, contract and tests see the same
// behaviour through the generic engine. Steps and signatures go through the 001 compatibility
// views (pr_approval_step, approval_action).
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
  type ResolvedRate,
} from '@ngo/shared';
import type { TenantTx } from '../../db/tx';
import { AppError } from '../../middleware/error';
import type { CommitmentRow } from '../../repositories/budget-line.repository';
import type {
  PrLineRecord,
  PrGrantRef,
  PrRecord,
  TenantSettings,
} from '../../repositories/pr.repository';
import type { BudgetService, LineAmount } from '../budget.service';
import type { ExchangeRateService } from '../exchange-rate.service';
import { assertGrantSelectableForPr, grantPrMismatch } from '../grant.service';
import type { NotificationService } from '../notification.service';
import type { NumberingService } from '../numbering.service';
import {
  assertCreator,
  assertEditable,
  assertGrantLinks,
  getPr,
  mayCancel,
  type PrActor,
  type PrRepos,
} from '../pr.service';
import type { DocAdapter, DocRef, WorkflowBinding } from './types';

export interface PrWorkflowRepos extends PrRepos {
  notifications: NotificationService;
}

/** A line that passed the completeness check. */
interface CompleteLine extends PrLineRecord {
  lineTotal: string;
  budgetLineId: string;
}

interface LockedLine {
  line: CompleteLine;
  rate: ResolvedRate;
  amountGrant: string;
}

/** What submit computed before the route: handed to the reservation and the header write. */
export interface PrSubmitState {
  settings: TenantSettings;
  grant: PrGrantRef;
  locked: LockedLine[];
  grantRate: ResolvedRate;
  doaRate: ResolvedRate;
  grantUnits: number;
  doaUnits: number;
  totalGrant: Decimal;
  reservations: CommitmentRow[];
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

/** The PR as eligibility checks and notifications see it (submitted: office is set). */
export function prRef(pr: PrRecord, number: string | null = pr.number): DocRef {
  return {
    id: pr.id,
    requesterId: pr.requesterId,
    requestingOfficeId: pr.requestingOfficeId!,
    number,
  };
}

export interface PrBindingDeps {
  actor: PrActor;
  budget: BudgetService;
  rates: ExchangeRateService;
  numbering: NumberingService;
  now: () => Date;
}

/** The PR adapter and its stores, bound to one transaction. */
export function prBinding(
  repos: PrWorkflowRepos,
  tx: TenantTx,
  deps: PrBindingDeps
): WorkflowBinding<PrRecord, PrSubmitState> {
  const { prs } = repos;
  const { budget, rates } = deps;

  const adapter: DocAdapter<PrRecord, PrSubmitState> = {
    docType: 'PR',
    doaType: 'PR',
    reassignPermissions: [PERMISSIONS.PR_REASSIGN],
    segregationMessages: {
      creator_approves: 'The requester cannot act on their own purchase requisition',
      same_user_two_steps:
        'A user who signed one step cannot sign another step of the same requisition',
    },

    load: async (id, { lock }) => {
      try {
        return await getPr(prs, id, { lock });
      } catch (err) {
        if (err instanceof AppError && err.code === 'NOT_FOUND') return null;
        throw err;
      }
    },
    creatorId: (pr) => pr.requesterId,
    officeId: (pr) => pr.requestingOfficeId!,

    assertMaySubmit(pr, actor) {
      assertCreator(pr, { ...deps.actor, ...actor });
      assertEditable(pr);
    },
    isPending: (status) => isPending(status as PrRecord['status']),
    pendingStatus: (step) =>
      step.kind === 'finance_check' ? 'pending_finance_check' : 'pending_approval',
    cancellable: (status) => canTransition(status as PrRecord['status'], 'cancel'),
    mayCancel: (pr) => mayCancel(pr, deps.actor),
    cancelForbiddenMessage: (pr) =>
      pr.status === 'approved'
        ? 'Missing permission pr:cancel_approved'
        : 'Only the requester can cancel this purchase requisition',

    async prepareSubmit(pr) {
      // --- the document itself --------------------------------------------------------------
      const lines = await prs.lines(pr.id);
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
      const submittedAt = deps.now();
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

      return {
        officeId,
        doaAmount: doaAmount.toFixed(doaUnits),
        timeZone: settings.timeZone,
        submittedAt,
        state: {
          settings,
          grant,
          locked,
          grantRate: rate(grant.currency),
          doaRate: rate(doaCurrency),
          grantUnits,
          doaUnits,
          totalGrant,
          reservations: [],
        },
      };
    },

    // --- budget (Business Rule 3, FR-037): locks the lines, then holds the amounts -------------
    async onSubmit(pr, plan, cycle) {
      const amounts: LineAmount[] = plan.state.locked.map((l) => ({
        budgetLineId: l.line.budgetLineId,
        amount: l.amountGrant,
        prLineIds: [l.line.id],
      }));
      plan.state.reservations = await budget.reserve(tx, pr.id, cycle, amounts);
    },

    async markSubmitted(pr, plan, info) {
      const s = plan.state;
      for (const l of s.locked) {
        await prs.lockLine(l.line.id, {
          rateToBase: l.rate.rateToBase,
          rateDate: l.rate.rateDate,
          rateSource: l.rate.source,
          exchangeRateId: l.rate.exchangeRateId,
          amountGrant: l.amountGrant,
        });
      }
      return prs.markSubmitted(pr.id, {
        number: info.number,
        submissionCycle: info.cycle,
        currentStepOrder: info.firstStepOrder,
        submittedAt: plan.submittedAt.toISOString(),
        requesterName: info.actor.nameEn,
        requesterPosition: info.actor.position,
        doaCurrency: s.settings.doaReferenceCurrency,
        doaAmount: plan.doaAmount,
        doaRateToBase: s.doaRate.rateToBase,
        doaRateDate: s.doaRate.rateDate,
        doaRateSource: s.doaRate.source,
        doaExchangeRateId: s.doaRate.exchangeRateId,
        grantRateToBase: s.grantRate.rateToBase,
        grantRateDate: s.grantRate.rateDate,
        grantRateSource: s.grantRate.source,
        grantExchangeRateId: s.grantRate.exchangeRateId,
        totalGrantCurrency: s.totalGrant.toFixed(s.grantUnits),
        printSnapshot: await prs.printSnapshot(pr.id),
      });
    },

    // a frozen grant blocks signing (FR-022) and its period must still cover the PR date
    // (FR-034); return, reject and cancel stay allowed
    async beforeSign(pr) {
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
    },

    // final approval: Reserved → Committed for the cycle (FR-036)
    async onApproved(pr) {
      await budget.commit(tx, pr.id, pr.submissionCycle);
    },

    // return, reject or cancel: every open hold of the PR is released (kept for audit)
    async onReleased(pr, reason) {
      await budget.release(tx, pr.id, reason);
    },

    setStatus(pr, change) {
      switch (change.kind) {
        case 'advanced':
          return prs.updateStatus(pr.id, {
            status: change.status as PrRecord['status'],
            currentStepOrder: change.currentStepOrder,
          });
        case 'approved':
          return prs.updateStatus(pr.id, {
            status: 'approved',
            approvedAt: change.at,
            currentStepOrder: null,
          });
        case 'rejected':
          return prs.updateStatus(pr.id, {
            status: 'rejected',
            currentStepOrder: null,
            rejectReason: change.reason,
            rejectedBy: change.by,
            closedAt: change.at,
          });
        case 'returned':
          return prs.updateStatus(pr.id, {
            status: 'returned',
            currentStepOrder: null,
            returnReason: change.reason,
          });
        case 'cancelled':
          return prs.updateStatus(pr.id, {
            status: 'cancelled',
            currentStepOrder: null,
            cancelReason: change.reason,
            cancelledBy: change.by,
            closedAt: change.at,
          });
        case 'touched':
          return prs.updateStatus(pr.id, {});
      }
    },

    ref: (pr, number) => prRef(pr, number === undefined ? pr.number : number),
  };

  return {
    adapter,
    steps: {
      list: (prId, cycle) => repos.steps.list(prId, cycle),
      update: (id, changes) => repos.steps.update(id, changes),
      cancelWaiting: (prId, cycle) => repos.steps.cancelWaiting(prId, cycle),
      materialise: (prId, cycle, route) =>
        repos.routing.materialiseSteps(tx.sql, { id: prId }, cycle, route),
    },
    signatures: {
      insert: ({ docId, action, ...row }) => repos.actions.insert({ ...row, prId: docId, action }),
      list: (prId) => repos.actions.list(prId),
    },
    routing: repos.routing,
    notifier: {
      async stepEligible(doc, step, actorName) {
        await repos.notifications.notifyStepEligible(doc, step, actorName);
      },
      creator: (doc, outcome, actorName) =>
        repos.notifications.notifyRequester(
          { ...doc, requesterId: doc.requesterId! },
          `pr_${outcome}`,
          actorName
        ),
      reassigned: (doc, step, userId, actorName) =>
        repos.notifications.notifyReassigned(doc, step, userId, actorName),
    },
    actorSnapshot: (userId) => prs.actor(userId),
    setAuditComment: (comment) => tx.setAuditComment(comment),
    assignNumber: (docType, officeId, submittedAt, timeZone) =>
      deps.numbering.assignNumber(tx.sql, docType, officeId, submittedAt, timeZone),
  };
}
