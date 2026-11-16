// PR state transitions (data-model §6). Each command runs in one tenant transaction that locks
// the PR and then its budget lines in ascending id order, so the budget check, numbering,
// reservation, signatures and notifications commit together or not at all (research R4).
// US4: submit. US5–US6 add approve, reject, return, change budget line, reassign and cancel.
import {
  DEFAULT_MINOR_UNITS,
  Decimal,
  addDays,
  calendarDateInTimeZone,
  convertLine,
  parseAmount,
  type PrSubmit,
  type PrSubmitResult,
  type ResolvedRate,
} from '@ngo/shared';
import { withTenantTx, type TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import { NotificationRepository } from '../repositories/notification.repository';
import { NumberingRepository } from '../repositories/numbering.repository';
import type { PrLineRecord, PrRecord } from '../repositories/pr.repository';
import type { RequestContext } from '../types/context';
import { BudgetService, type LineAmount } from './budget.service';
import { ExchangeRateService } from './exchange-rate.service';
import { assertGrantSelectableForPr } from './grant.service';
import { NotificationService } from './notification.service';
import { NumberingService, numberingTxStore } from './numbering.service';
import {
  actorOf,
  assertCreator,
  assertEditable,
  assertGrantLinks,
  assertVersion,
  getPr,
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
}
