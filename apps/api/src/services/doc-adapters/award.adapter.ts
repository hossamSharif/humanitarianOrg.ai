// The quotation analysis as an AWARD document (research D1, R22; US5). Submission needs every
// eligible committee member's signature, a recommendation, enough valid offers (or an approved
// fewer-quotations waiver, FR-022) and awardable suppliers; the DoA amount is the awarded amount
// in the DoA reference currency at the submission date. Segregation keeps the requesters of the
// PRs feeding the event off every approval step (pr_creator_approves_award). Final approval runs
// the FR-030 budget check — awarded amount per budget line ≤ what the PR lines committed +
// Available — and writes nothing to budget_commitment; then the event is awarded and the
// unsuccessful offers get notice placeholders.
import {
  Decimal,
  PERMISSIONS,
  PERMISSIONS_002,
  calendarDateInTimeZone,
  convert,
  parseAmount,
  type ResolvedRate,
} from '@ngo/shared';
import type { TenantTx } from '../../db/tx';
import { AppError } from '../../middleware/error';
import type { BidAnalysisRecord } from '../../repositories/bid-analysis.repository';
import type { RequestContext } from '../../types/context';
import { analysisRepos, eligibleMembers, type AnalysisRepos } from '../analysis.service';
import { BudgetService } from '../budget.service';
import type { DocAdapter, DocRef } from './types';

export interface AwardSubmitState {
  doaCurrency: string;
  doaRate: ResolvedRate;
  waiverId: string | null;
}

const WORKFLOW_STATUSES = new Set(['pending_approval']);
const CANCELLABLE = new Set(['draft', 'scoring', 'signing', 'returned', 'pending_approval']);

/** 422 SUPPLIER_NOT_ELIGIBLE for the first awarded supplier that cannot be awarded (US2-1). */
async function assertSuppliersAwardable(repos: AnalysisRepos, analysisId: string): Promise<void> {
  for (const s of await repos.awards.supplierCompliance(analysisId)) {
    const reasons: string[] = [];
    if (s.status === 'blacklisted') reasons.push('blacklisted');
    else if (s.status !== 'approved') reasons.push('not_approved');
    if (s.vettingOverdue) reasons.push('vetting_overdue');
    if (s.expiredDoc) reasons.push('expired_document');
    if (reasons.length) {
      throw new AppError('SUPPLIER_NOT_ELIGIBLE', 'The awarded supplier is not eligible', {
        supplierId: s.supplierId,
        reasons,
      });
    }
  }
}

/** Valid offers below the minimum proceed only with an approved waiver on the event (FR-022). */
async function fewerOffersWaiver(
  repos: AnalysisRepos,
  analysis: BidAnalysisRecord
): Promise<string | null> {
  const valid = await repos.offers.countValid(analysis.sourcingEventId);
  if (valid >= analysis.requiredMinQuotations) return null;
  const docType = analysis.eventKind === 'rfq' ? 'RFQ' : 'TND';
  const [waiver] = await repos.tx.sql<{ id: string }[]>`
    select id from public.waiver
    where tenant_id = ${repos.ctx.tenantId} and status = 'approved'
      and covered_doc_type = ${docType} and covered_doc_id = ${analysis.sourcingEventId}
      and reason_category in ('fewer_quotations', 'single_source')
    limit 1`;
  if (!waiver) {
    throw new AppError('TOO_FEW_SUPPLIERS', 'Too few valid offers without an approved waiver', {
      required: analysis.requiredMinQuotations,
      actual: valid,
    });
  }
  return waiver.id;
}

export function awardAdapter(
  tx: TenantTx,
  ctx: RequestContext,
  budget: BudgetService = BudgetService.forContext(ctx)
): DocAdapter<BidAnalysisRecord, AwardSubmitState> {
  const repos = analysisRepos(tx, ctx);
  const { analyses } = repos;

  const ref = (a: BidAnalysisRecord, number: string | null = a.number): DocRef => ({
    id: a.id,
    requesterId: a.createdBy,
    requestingOfficeId: a.officeId,
    number,
  });

  /** Awarded amounts per budget line in the grant currency, at the rates of `date`. */
  async function awardedInGrant(a: BidAnalysisRecord, date: string) {
    const [grant] = await tx.sql<{ currency: string }[]>`
      select g.currency::text from public.sourcing_event e
      join public.grant g on g.id = e.grant_id
      where e.id = ${a.sourcingEventId}`;
    const amounts = await repos.awards.byBudgetLine(a.id);
    const rates = await repos.rates.resolveRates(
      tx,
      [...amounts.map((x) => x.currency), grant!.currency],
      date
    );
    const grantRate = rates.get(grant!.currency)!.rateToBase;
    const perLine = new Map<string, Decimal>();
    for (const x of amounts) {
      const inGrant = parseAmount(convert(x.amount, rates.get(x.currency)!.rateToBase, grantRate));
      perLine.set(x.budgetLineId, (perLine.get(x.budgetLineId) ?? new Decimal(0)).plus(inGrant));
    }
    return perLine;
  }

  return {
    docType: 'QA',
    doaType: 'AWARD',
    reassignPermissions: [PERMISSIONS.SETTINGS_MANAGE],

    load: (id, { lock }) => analyses.find(id, { lock }),
    creatorId: (a) => a.createdBy,
    officeId: (a) => a.officeId,
    async segregationFacts(a) {
      return { prRequesterIds: await analyses.prRequesterIds(a.sourcingEventId) };
    },

    assertMaySubmit(a, actor) {
      if (
        !actor.permissions.has(PERMISSIONS_002.RFQ_CREATE) &&
        !actor.permissions.has(PERMISSIONS_002.TENDER_MANAGE)
      ) {
        throw new AppError('FORBIDDEN', `Missing permission ${PERMISSIONS_002.RFQ_CREATE}`);
      }
      if (a.status !== 'signing' && a.status !== 'returned') {
        throw new AppError('INVALID_STATE', 'The committee must sign the analysis first');
      }
    },
    isPending: (status) => WORKFLOW_STATUSES.has(status),
    pendingStatus: () => 'pending_approval',
    cancellable: (status) => CANCELLABLE.has(status),
    mayCancel: (_a, actor) =>
      actor.permissions.has(PERMISSIONS_002.RFQ_CREATE) ||
      actor.permissions.has(PERMISSIONS_002.TENDER_MANAGE),

    async prepareSubmit(a) {
      const members = await repos.members.list(a.id);
      const eligible = eligibleMembers(members);
      const minimum = await analyses.committeeMinSize();
      if (eligible.length < minimum) {
        throw new AppError('COMMITTEE_TOO_SMALL', 'Too few eligible committee members', {
          minimum,
          eligible: eligible.length,
        });
      }
      if (eligible.some((m) => m.signedAt === null)) {
        throw new AppError('INVALID_STATE', 'Every eligible committee member must sign first');
      }
      if ((await repos.awards.list(a.id)).length === 0) {
        throw new AppError('VALIDATION_ERROR', 'The analysis has no recommendation', [
          { field: 'recommendation', message: 'required' },
        ]);
      }
      const waiverId = await fewerOffersWaiver(repos, a);
      await assertSuppliersAwardable(repos, a.id);

      // DoA amount: the awarded amounts in the DoA reference currency at the submission date
      const facts = await repos.events.tenantFacts();
      const submittedAt = new Date();
      const date = calendarDateInTimeZone(submittedAt, facts.timeZone);
      const amounts = await repos.awards.byBudgetLine(a.id);
      const rates = await repos.rates.resolveRates(
        tx,
        [...amounts.map((x) => x.currency), facts.doaCurrency],
        date
      );
      const doaRate = rates.get(facts.doaCurrency)!;
      const doaAmount = amounts
        .reduce(
          (sum, x) =>
            sum.plus(convert(x.amount, rates.get(x.currency)!.rateToBase, doaRate.rateToBase)),
          new Decimal(0)
        )
        .toFixed(2);

      return {
        officeId: a.officeId,
        doaAmount,
        timeZone: facts.timeZone,
        submittedAt,
        state: { doaCurrency: facts.doaCurrency, doaRate, waiverId },
      };
    },

    async onSubmit(a) {
      await repos.events.setStatus(a.sourcingEventId, 'evaluated');
    },

    markSubmitted: (a, plan, info) =>
      analyses.markSubmitted(a.id, {
        number: info.number,
        status: info.firstStepStatus,
        submissionCycle: info.cycle,
        currentStepOrder: info.firstStepOrder,
        submittedAt: plan.submittedAt.toISOString(),
        doaCurrency: plan.state.doaCurrency,
        doaAmount: plan.doaAmount,
        doaRateToBase: plan.state.doaRate.rateToBase,
        doaRateDate: plan.state.doaRate.rateDate,
        doaRateSource: plan.state.doaRate.source,
        doaExchangeRateId: plan.state.doaRate.exchangeRateId,
        waiverId: plan.state.waiverId,
      }),

    /**
     * FR-030: per budget line, the awarded amount (grant currency, approval-date rates) may
     * exceed what the awarded PR lines committed only by what is Available. Nothing is written.
     */
    async onApproved(a) {
      await assertSuppliersAwardable(repos, a.id);
      const facts = await repos.events.tenantFacts();
      const awarded = await awardedInGrant(a, facts.today);
      const committed = new Map(
        (await repos.awards.prCommitments(a.id)).map((c) => [c.budgetLineId, c])
      );
      const increases = [...awarded]
        .map(([budgetLineId, amount]) => {
          const pr = committed.get(budgetLineId);
          const delta = amount.minus(pr ? parseAmount(pr.amountGrant) : 0);
          return { budgetLineId, amount: delta.toFixed(2), prLineIds: pr?.prLineIds ?? [] };
        })
        .filter((x) => parseAmount(x.amount).gt(0));
      if (increases.length) {
        const shortfalls = await budget.shortfallFor(tx, increases);
        if (shortfalls.length) {
          throw new AppError('BUDGET_EXCEEDED', 'The award exceeds the available budget', {
            lines: shortfalls,
          });
        }
      }
    },

    async onReleased(a) {
      const event = await repos.events.get(a.sourcingEventId);
      if (event.status === 'evaluated') await repos.events.setStatus(event.id, 'opened');
    },

    async setStatus(a, change) {
      switch (change.kind) {
        case 'advanced':
          return analyses.updateWorkflow(a.id, {
            status: change.status,
            currentStepOrder: change.currentStepOrder,
          });
        case 'approved': {
          const version = await analyses.updateWorkflow(a.id, {
            status: 'approved',
            approvedAt: change.at,
            currentStepOrder: null,
          });
          // after the status write: the event trigger keeps only approved award lines open
          await repos.events.setStatus(a.sourcingEventId, 'awarded');
          await repos.notices.createPlaceholders(a.id, a.sourcingEventId);
          return version;
        }
        case 'rejected':
          return analyses.updateWorkflow(a.id, {
            status: 'rejected',
            currentStepOrder: null,
            rejectReason: change.reason,
          });
        case 'returned':
          return analyses.updateWorkflow(a.id, {
            status: 'returned',
            currentStepOrder: null,
            returnReason: change.reason,
          });
        case 'cancelled':
          return analyses.updateWorkflow(a.id, {
            status: 'cancelled',
            currentStepOrder: null,
            cancelReason: change.reason,
            cancelledAt: change.at,
          });
        case 'touched':
          return analyses.updateWorkflow(a.id, {});
      }
    },

    ref: (a, number) => ref(a, number === undefined ? a.number : number),
  };
}
