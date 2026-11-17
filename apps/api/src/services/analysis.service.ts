// Quotation analysis, committee and recommendation (002 US5, FR-023…FR-029; research R22). One
// analysis per opened sourcing event: the committee is seated, each member declares conflicts of
// interest once (declare_coi), eligible members score the non-price criteria, and scoring.ts
// rewrites the result snapshot — totals compared in the event currency at the opening-date
// rates — until the first committee signature freezes it. A recommendation other than the
// highest total needs a justification tied to published criteria. Once every eligible member has
// signed, the analysis enters DoA as an AWARD (doc-adapters/award.adapter.ts).
import {
  Decimal,
  PERMISSIONS_002,
  calendarDateInTimeZone,
  convert,
  scoreAnalysis,
  type AnalysisListQuery,
  type AnalysisResultView,
  type AnalysisSignInput,
  type BidAnalysisDetail,
  type BidAnalysisSummary,
  type CommitteeInput,
  type ComparisonRate,
  type CreateAnalysisInput,
  type DeclarationInput,
  type DisqualifyInput,
  type ListResponse,
  type NoticesInput,
  type RecommendationInput,
  type ScoresInput,
} from '@ngo/shared';
import { withTenantTx, type TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import { AnalysisResultRepository } from '../repositories/analysis-result.repository';
import { AwardLineRepository } from '../repositories/award-line.repository';
import {
  BidAnalysisRepository,
  type BidAnalysisRecord,
} from '../repositories/bid-analysis.repository';
import {
  CommitteeMemberRepository,
  type CommitteeMemberRecord,
} from '../repositories/committee-member.repository';
import { DocSignatureRepository } from '../repositories/doc-signature.repository';
import { EvaluationScoreRepository } from '../repositories/evaluation-score.repository';
import { OfferTermsRepository } from '../repositories/offer-terms.repository';
import { OfferRepository } from '../repositories/offer.repository';
import { SourcingCriterionRepository } from '../repositories/sourcing-criterion.repository';
import { SourcingEventRepository } from '../repositories/sourcing-event.repository';
import { SourcingLineRepository } from '../repositories/sourcing-line.repository';
import { UnsuccessfulNoticeRepository } from '../repositories/unsuccessful-notice.repository';
import { WaiverRepository } from '../repositories/waiver.repository';
import type { RequestContext } from '../types/context';
import { ensureTenantSeeds } from './doc-adapters/binding';
import { ExchangeRateService } from './exchange-rate.service';
import { assertCanSign } from './segregation.service';

export interface AnalysisRepos {
  tx: TenantTx;
  ctx: RequestContext;
  analyses: BidAnalysisRepository;
  members: CommitteeMemberRepository;
  scores: EvaluationScoreRepository;
  results: AnalysisResultRepository;
  awards: AwardLineRepository;
  notices: UnsuccessfulNoticeRepository;
  events: SourcingEventRepository;
  lines: SourcingLineRepository;
  criteria: SourcingCriterionRepository;
  offers: OfferRepository;
  terms: OfferTermsRepository;
  waivers: WaiverRepository;
  signatures: DocSignatureRepository;
  rates: ExchangeRateService;
}

export interface AnalysisServiceDeps {
  run<T>(ctx: RequestContext, fn: (repos: AnalysisRepos) => Promise<T>): Promise<T>;
}

export function analysisRepos(tx: TenantTx, ctx: RequestContext): AnalysisRepos {
  const t = ctx.tenantId;
  return {
    tx,
    ctx,
    analyses: new BidAnalysisRepository(tx.sql, t),
    members: new CommitteeMemberRepository(tx.sql, t),
    scores: new EvaluationScoreRepository(tx.sql, t),
    results: new AnalysisResultRepository(tx.sql, t),
    awards: new AwardLineRepository(tx.sql, t),
    notices: new UnsuccessfulNoticeRepository(tx.sql, t),
    events: new SourcingEventRepository(tx.sql, t),
    lines: new SourcingLineRepository(tx.sql, t),
    criteria: new SourcingCriterionRepository(tx.sql, t),
    offers: new OfferRepository(tx.sql, t),
    terms: new OfferTermsRepository(tx.sql, t),
    waivers: new WaiverRepository(tx.sql, t),
    signatures: new DocSignatureRepository(tx.sql, t, 'QA'),
    rates: ExchangeRateService.forContext(ctx),
  };
}

export const defaultAnalysisDeps: AnalysisServiceDeps = {
  run: (ctx, fn) =>
    withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, async (tx) => {
      await ensureTenantSeeds(tx);
      return fn(analysisRepos(tx, ctx));
    }),
};

/** Statuses in which the committee works (before the freeze, or returned for rework). */
const WORKING = new Set(['draft', 'scoring']);
const COMPETING_OFFER = new Set(['logged', 'late_accepted', 'disqualified']);

function assertVersion(current: { version: number }, expected: number): void {
  if (current.version !== expected) {
    throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
  }
}

function assertNotFrozen(analysis: BidAnalysisRecord): void {
  if (analysis.frozenAt) {
    throw new AppError('OFFER_FROZEN', 'The analysis results are frozen by a committee signature');
  }
}

function canManage(ctx: RequestContext): boolean {
  return (
    ctx.permissions.has(PERMISSIONS_002.RFQ_CREATE) ||
    ctx.permissions.has(PERMISSIONS_002.TENDER_MANAGE)
  );
}

function assertManage(ctx: RequestContext): void {
  if (!canManage(ctx)) {
    throw new AppError('FORBIDDEN', `Missing permission ${PERMISSIONS_002.RFQ_CREATE}`);
  }
}

/** Members that may score and sign: declared, no conflict, not replaced. */
export function eligibleMembers(members: readonly CommitteeMemberRecord[]) {
  return members.filter((m) => m.eligible);
}

/**
 * The recommendation differs from the computed best (whole: the highest total; split: each
 * line's best) — then a justification and at least one criterion are required (FR-027).
 */
export function needsJustification(
  analysis: Pick<BidAnalysisRecord, 'recommendedOfferId' | 'highestOfferId'>,
  awardLines: readonly { sourcingLineId: string; offerId: string }[],
  lineResults: readonly AnalysisResultView[],
  split: boolean
): boolean {
  if (!split) return analysis.recommendedOfferId !== analysis.highestOfferId;
  return awardLines.some((a) => {
    const best = lineResults.find((r) => r.sourcingLineId === a.sourcingLineId && r.rank === 1);
    return best?.offerId !== a.offerId;
  });
}

export class AnalysisService {
  constructor(private readonly deps: AnalysisServiceDeps = defaultAnalysisDeps) {}

  // --- reads ---------------------------------------------------------------------------------

  list(ctx: RequestContext, query: AnalysisListQuery): Promise<ListResponse<BidAnalysisSummary>> {
    return this.deps.run(ctx, ({ analyses }) =>
      analyses.list({ page: query.page, pageSize: query.pageSize, status: query.status })
    );
  }

  /** The analysis without the workflow steps (added by the route from the engine). */
  get(ctx: RequestContext, id: string): Promise<Omit<BidAnalysisDetail, 'steps'>> {
    return this.deps.run(ctx, (repos) => this.detail(repos, id));
  }

  async detail(repos: AnalysisRepos, id: string): Promise<Omit<BidAnalysisDetail, 'steps'>> {
    const analysis = await repos.analyses.get(id);
    const eventId = analysis.sourcingEventId;
    const [criteria, lines, receipts, members, allResults, awardLines, notices, minSize, visible] =
      await Promise.all([
        repos.criteria.list(eventId),
        repos.lines.list(eventId),
        repos.offers.list(eventId),
        repos.members.list(id),
        repos.results.list(id),
        repos.awards.list(id),
        repos.notices.list(id),
        repos.analyses.committeeMinSize(),
        this.pricesVisible(repos, eventId),
      ]);
    const terms = visible ? await repos.terms.list(eventId) : [];
    const me = members.find((m) => m.userId === repos.ctx.userId && m.replacedById === null);
    const myScores = me ? await repos.scores.ofMember(id, me.id) : [];
    const hide = (r: AnalysisResultView): AnalysisResultView =>
      visible
        ? r
        : {
            ...r,
            totalOfferCurrency: null,
            totalEventCurrency: null,
            pricePoints: null,
            weightedTotal: null,
          };

    const offers = receipts
      .filter((o) => COMPETING_OFFER.has(o.status))
      .map((o) => ({
        offerId: o.id,
        supplierId: o.supplierId,
        supplierNameAr: o.supplierNameAr,
        supplierNameEn: o.supplierNameEn,
        status: o.status,
        currency: terms.find((t) => t.offerId === o.id)?.currency ?? null,
        disqualificationReason: o.disqualificationReason,
      }));

    return {
      id: analysis.id,
      number: analysis.number,
      status: analysis.status,
      sourcingEventId: eventId,
      eventNumber: analysis.eventNumber,
      eventTitle: analysis.eventTitle,
      awardedAmount: visible ? analysis.awardedAmount : null,
      eventCurrency: analysis.eventCurrency,
      createdAt: analysis.createdAt,
      version: analysis.version,
      officeId: analysis.officeId,
      createdBy: analysis.createdBy,
      splitAwardAllowed: analysis.splitAwardAllowed,
      requiredMinQuotations: analysis.requiredMinQuotations,
      validOfferCount: receipts.filter((o) => o.status === 'logged' || o.status === 'late_accepted')
        .length,
      waiverId: analysis.waiverId,
      comparisonRates: analysis.comparisonRates,
      pricesVisible: visible,
      committeeMinSize: minSize,
      eligibleMemberCount: eligibleMembers(members).length,
      criteria: criteria.map((c) => ({
        id: c.id,
        stage: c.stage,
        kind: c.kind,
        code: c.code,
        nameAr: c.nameAr,
        nameEn: c.nameEn,
        weightPct: c.weightPct,
        isPrice: c.isPrice,
      })),
      lines: lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        description: l.description,
        quantity: l.quantity,
      })),
      offers,
      committee: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        nameAr: m.nameAr,
        nameEn: m.nameEn,
        function: m.function,
        declaredAt: m.declaredAt,
        hasConflict: m.hasConflict,
        conflictSupplierIds: m.conflictSupplierIds,
        excluded: m.excluded,
        replacedById: m.replacedById,
        signedAt: m.signedAt,
      })),
      myScores,
      results: allResults.filter((r) => r.sourcingLineId === null).map(hide),
      lineResults: allResults.filter((r) => r.sourcingLineId !== null).map(hide),
      highestOfferId: analysis.highestOfferId,
      recommendedOfferId: analysis.recommendedOfferId,
      justification: analysis.justification,
      justificationCriterionIds: analysis.justificationCriterionIds,
      awardLines: visible ? awardLines : [],
      awardedAmountDoa: analysis.awardedAmountDoa,
      doaCurrency: analysis.doaCurrency,
      frozenAt: analysis.frozenAt,
      notices,
      availableActions: this.actionsFor(repos.ctx, analysis, members),
    };
  }

  actionsFor(
    ctx: RequestContext,
    analysis: BidAnalysisRecord,
    members: readonly CommitteeMemberRecord[]
  ): string[] {
    const actions: string[] = [];
    const me = members.find((m) => m.userId === ctx.userId && m.replacedById === null);
    const working = WORKING.has(analysis.status) && !analysis.frozenAt;
    if (working && canManage(ctx)) actions.push('committee', 'recommend');
    if (working && me && me.declaredAt === null) actions.push('declare');
    if (working && me?.eligible && ctx.permissions.has(PERMISSIONS_002.EVALUATION_SCORE)) {
      actions.push('score', 'disqualify');
    }
    if (
      (working || analysis.status === 'signing') &&
      me?.eligible &&
      me.signedAt === null &&
      analysis.awardedAmount !== null &&
      ctx.permissions.has(PERMISSIONS_002.EVALUATION_SIGN)
    ) {
      actions.push('sign');
    }
    const eligible = eligibleMembers(members);
    if (
      (analysis.status === 'signing' || analysis.status === 'returned') &&
      canManage(ctx) &&
      eligible.length > 0 &&
      eligible.every((m) => m.signedAt !== null)
    ) {
      actions.push('submit');
    }
    if (analysis.status === 'approved' && canManage(ctx)) actions.push('notices');
    return actions;
  }

  private async pricesVisible(repos: AnalysisRepos, eventId: string): Promise<boolean> {
    const [row] = await repos.tx.sql<{ visible: boolean }[]>`
      select app.may_see_offer_prices(${eventId}) as visible`;
    return row?.visible ?? false;
  }

  // --- create --------------------------------------------------------------------------------

  /** POST /bid-analyses — after the opening; one live analysis per event. */
  create(
    ctx: RequestContext,
    input: CreateAnalysisInput
  ): Promise<Omit<BidAnalysisDetail, 'steps'>> {
    assertManage(ctx);
    return this.deps.run(ctx, async (repos) => {
      const event = await repos.events.get(input.sourcingEventId);
      if (!event.openedAt || !['opened', 'evaluated'].includes(event.status)) {
        throw new AppError('SOURCING_NOT_OPENED', 'The quotations have not been opened');
      }
      if (await repos.analyses.liveForEvent(event.id)) {
        throw new AppError('INVALID_STATE', 'This sourcing event already has an analysis');
      }
      const rates = await this.comparisonRates(repos, event.openedAt, [event.currency], []);
      const id = await repos.analyses.insert(event.id, rates);
      await this.recompute(repos, id);
      return this.detail(repos, id);
    });
  }

  /** Rates at the opening date for `currencies`, keeping the ones already resolved (FR-023). */
  private async comparisonRates(
    repos: AnalysisRepos,
    openedAt: string,
    currencies: readonly string[],
    known: readonly ComparisonRate[]
  ): Promise<ComparisonRate[]> {
    const missing = [...new Set(currencies)].filter((c) => !known.some((k) => k.currency === c));
    if (missing.length === 0) return [...known];
    const { timeZone } = await repos.events.tenantFacts();
    const date = calendarDateInTimeZone(openedAt, timeZone);
    const resolved = await repos.rates.resolveRates(repos.tx, missing, date);
    return [
      ...known,
      ...missing.map((currency) => {
        const r = resolved.get(currency)!;
        return {
          currency,
          rateToBase: r.rateToBase,
          rateDate: r.rateDate,
          source: r.source,
          exchangeRateId: r.exchangeRateId,
        };
      }),
    ];
  }

  /**
   * Rewrites the result snapshot from the opened offers and the eligible members' scores
   * (scoring.ts). Runs only for a caller who may see prices and only before the freeze.
   */
  private async recompute(repos: AnalysisRepos, id: string): Promise<void> {
    const analysis = await repos.analyses.get(id);
    if (analysis.frozenAt || !analysis.eventOpenedAt) return;
    const eventId = analysis.sourcingEventId;
    if (!(await this.pricesVisible(repos, eventId))) return;

    const [criteria, lines, receipts, terms, scores] = await Promise.all([
      repos.criteria.list(eventId),
      repos.lines.list(eventId),
      repos.offers.list(eventId),
      repos.terms.list(eventId),
      repos.scores.eligible(id),
    ]);
    const competing = receipts.filter((o) => COMPETING_OFFER.has(o.status));
    const priced = competing.filter((o) => terms.some((t) => t.offerId === o.id));

    const rates = await this.comparisonRates(
      repos,
      analysis.eventOpenedAt,
      [
        analysis.eventCurrency,
        ...priced.map((o) => terms.find((t) => t.offerId === o.id)!.currency),
      ],
      analysis.comparisonRates
    );
    if (rates.length !== analysis.comparisonRates.length) {
      await repos.tx.sql`
        update public.bid_analysis
        set comparison_rates = ${repos.tx.sql.json(rates as unknown as Parameters<TenantTx['sql']['json']>[0])}
        where id = ${id}`;
    }
    const rateOf = (currency: string) => rates.find((r) => r.currency === currency)!.rateToBase;

    const result = scoreAnalysis({
      criteria,
      offers: priced.map((o) => {
        const t = terms.find((x) => x.offerId === o.id)!;
        return {
          offerId: o.id,
          currency: t.currency,
          rateToBase: rateOf(t.currency),
          essential: Object.fromEntries(
            Object.entries(t.essentialCompliance).map(([k, v]) => [k, v.result])
          ),
          lines: t.linePrices.map((p) => ({
            sourcingLineId: p.sourcingLineId,
            lineTotal: p.lineTotal,
          })),
          disqualificationReason: o.status === 'disqualified' ? o.disqualificationReason : null,
        };
      }),
      scores,
      lineIds: lines.map((l) => l.id),
      eventRateToBase: rateOf(analysis.eventCurrency),
      splitAward: analysis.splitAwardAllowed,
      twoStage: analysis.eventKind === 'tender' && criteria.some((c) => c.stage === 'technical'),
    });
    await repos.results.replace(id, [...result.offers, ...result.lines]);
    await repos.analyses.setHighest(id, result.highestOfferId);
  }

  private async locked(repos: AnalysisRepos, id: string): Promise<BidAnalysisRecord> {
    return repos.analyses.get(id, { lock: true });
  }

  private async moveToScoring(repos: AnalysisRepos, analysis: BidAnalysisRecord): Promise<void> {
    if (analysis.status === 'draft') await repos.analyses.setStatus(analysis.id, 'scoring');
  }

  // --- committee -----------------------------------------------------------------------------

  /**
   * PUT /bid-analyses/:id/committee — the whole committee. An undeclared member who is left out
   * is removed; a declared one leaves only through a replacement naming them.
   */
  setCommittee(
    ctx: RequestContext,
    id: string,
    input: CommitteeInput
  ): Promise<Omit<BidAnalysisDetail, 'steps'>> {
    assertManage(ctx);
    return this.deps.run(ctx, async (repos) => {
      const analysis = await this.locked(repos, id);
      assertVersion(analysis, input.expectedVersion);
      if (!WORKING.has(analysis.status)) {
        throw new AppError(
          'INVALID_STATE',
          `The committee of a ${analysis.status} analysis is fixed`
        );
      }
      assertNotFrozen(analysis);
      const userIds = input.members.map((m) => m.userId);
      if (new Set(userIds).size !== userIds.length) {
        throw new AppError('VALIDATION_ERROR', 'A member is listed twice', [
          { field: 'members', message: 'duplicate' },
        ]);
      }
      for (const userId of userIds) {
        if (!(await repos.members.isMember(userId))) {
          throw new AppError('VALIDATION_ERROR', 'A committee member is not an active user', [
            { field: 'members', message: 'invalid_reference' },
          ]);
        }
      }

      const current = await repos.members.list(id);
      const active = current.filter((m) => m.replacedById === null);
      for (const m of active) {
        const kept = input.members.find((x) => x.userId === m.userId);
        if (kept) {
          await repos.members.setFunction(m.id, kept.function);
          continue;
        }
        if (m.declaredAt === null) {
          await repos.members.remove(m.id);
          continue;
        }
        if (!input.members.some((x) => x.replacesUserId === m.userId)) {
          throw new AppError(
            'INVALID_STATE',
            'A member who declared can only leave through a replacement'
          );
        }
      }
      for (const m of input.members) {
        if (active.some((x) => x.userId === m.userId)) continue;
        if (current.some((x) => x.userId === m.userId)) {
          throw new AppError('VALIDATION_ERROR', 'A replaced member cannot be seated again', [
            { field: 'members', message: 'replaced' },
          ]);
        }
        const newId = await repos.members.insert(id, m.userId, m.function);
        if (m.replacesUserId) {
          const replaced = active.find((x) => x.userId === m.replacesUserId);
          if (!replaced) {
            throw new AppError('VALIDATION_ERROR', 'The replaced member is not on the committee', [
              { field: 'members', message: 'invalid_reference' },
            ]);
          }
          await repos.members.markReplaced(replaced.id, newId);
        }
      }
      await repos.analyses.touch(id, input.expectedVersion);
      await this.recompute(repos, id);
      return this.detail(repos, id);
    });
  }

  /** POST /bid-analyses/:id/declaration — the caller's declaration, made once (US5-5). */
  declare(
    ctx: RequestContext,
    id: string,
    input: DeclarationInput
  ): Promise<Omit<BidAnalysisDetail, 'steps'>> {
    return this.deps.run(ctx, async (repos) => {
      const analysis = await this.locked(repos, id);
      if (!WORKING.has(analysis.status)) {
        throw new AppError('INVALID_STATE', `A ${analysis.status} analysis takes no declaration`);
      }
      const me = (await repos.members.list(id)).find(
        (m) => m.userId === ctx.userId && m.replacedById === null
      );
      if (!me) throw new AppError('FORBIDDEN', 'You are not on this committee');
      if (me.declaredAt !== null) {
        throw new AppError('INVALID_STATE', 'You have already declared');
      }
      const hasConflict = input.hasConflict;
      const conflictSupplierIds = hasConflict ? (input.conflictSupplierIds ?? []) : [];
      await repos.members.declare(me.id, {
        hasConflict,
        conflictSupplierIds,
        note: input.note?.trim() || null,
      });
      const actor = await this.actor(repos);
      await repos.signatures.insert({
        docId: id,
        stepId: null,
        cycle: 1,
        stepOrder: null,
        action: 'declare_coi',
        userName: actor.nameEn,
        userPosition: actor.position,
        comment: input.note?.trim() || null,
        payload: { hasConflict, conflictSupplierIds, nameAr: actor.nameAr },
      });
      await this.moveToScoring(repos, analysis);
      return this.detail(repos, id);
    });
  }

  // --- scoring -------------------------------------------------------------------------------

  /**
   * PUT /bid-analyses/:id/scores — the caller's 1–5 scores on non-price criteria. Refused for an
   * undeclared or conflicted member (DECLARATION_REQUIRED) and while the eligible committee is
   * below the minimum (COMMITTEE_TOO_SMALL).
   */
  putScores(
    ctx: RequestContext,
    id: string,
    input: ScoresInput
  ): Promise<Omit<BidAnalysisDetail, 'steps'>> {
    return this.deps.run(ctx, async (repos) => {
      const analysis = await this.locked(repos, id);
      if (!WORKING.has(analysis.status)) {
        throw new AppError('INVALID_STATE', `A ${analysis.status} analysis takes no scores`);
      }
      assertNotFrozen(analysis);
      const members = await repos.members.list(id);
      const me = members.find((m) => m.userId === ctx.userId && m.replacedById === null);
      if (!me) throw new AppError('FORBIDDEN', 'You are not on this committee');
      if (me.declaredAt === null) {
        throw new AppError('DECLARATION_REQUIRED', 'Declare conflicts of interest before scoring');
      }
      assertCanSign(
        {
          docType: 'QA',
          creatorId: analysis.createdBy,
          declaration: { hasConflict: me.hasConflict === true },
        },
        ctx.userId,
        { kind: 'score' },
        []
      );
      const minimum = await repos.analyses.committeeMinSize();
      const eligible = eligibleMembers(members).length;
      if (eligible < minimum) {
        throw new AppError('COMMITTEE_TOO_SMALL', 'Too few eligible committee members to score', {
          minimum,
          eligible,
        });
      }

      const criteria = await repos.criteria.list(analysis.sourcingEventId);
      const scorable = new Set(
        criteria.filter((c) => c.kind === 'weighted' && !c.isPrice).map((c) => c.id)
      );
      if (input.scores.some((s) => !scorable.has(s.criterionId))) {
        throw new AppError('VALIDATION_ERROR', 'Price points are computed, never scored', [
          { field: 'scores', message: 'not_scorable' },
        ]);
      }
      const offers = new Set(
        (await repos.offers.list(analysis.sourcingEventId))
          .filter((o) => COMPETING_OFFER.has(o.status))
          .map((o) => o.id)
      );
      if (input.scores.some((s) => !offers.has(s.offerId))) {
        throw new AppError('VALIDATION_ERROR', 'A score is for an offer outside the comparison', [
          { field: 'scores', message: 'invalid_reference' },
        ]);
      }
      await repos.scores.upsert(id, me.id, input.scores);
      await this.moveToScoring(repos, analysis);
      await this.recompute(repos, id);
      return this.detail(repos, id);
    });
  }

  /** POST /bid-analyses/:id/disqualify — with the reason (FR-025). */
  disqualify(
    ctx: RequestContext,
    id: string,
    input: DisqualifyInput
  ): Promise<Omit<BidAnalysisDetail, 'steps'>> {
    return this.deps.run(ctx, async (repos) => {
      const analysis = await this.locked(repos, id);
      if (!WORKING.has(analysis.status)) {
        throw new AppError('INVALID_STATE', `Offers of a ${analysis.status} analysis are fixed`);
      }
      assertNotFrozen(analysis);
      const members = await repos.members.list(id);
      const me = members.find((m) => m.userId === ctx.userId && m.replacedById === null);
      if (me && !me.eligible) {
        throw new AppError('DECLARATION_REQUIRED', 'Declare no conflict before evaluating offers');
      }
      const offer = await repos.offers.get(analysis.sourcingEventId, input.offerId);
      if (offer.status !== 'logged' && offer.status !== 'late_accepted') {
        throw new AppError('INVALID_STATE', `A ${offer.status} offer cannot be disqualified`);
      }
      await repos.tx.setAuditComment(input.reason);
      await repos.tx.sql`
        update public.offer
        set status = 'disqualified', disqualification_reason = ${input.reason.trim()}
        where tenant_id = ${ctx.tenantId} and id = ${input.offerId}`;
      await this.moveToScoring(repos, analysis);
      await this.recompute(repos, id);
      return this.detail(repos, id);
    });
  }

  // --- recommendation and signatures ---------------------------------------------------------

  /**
   * PUT /bid-analyses/:id/recommendation — one offer for the whole award, or one per line when
   * the event allows a split. Writes the award lines from the offers' prices and the PR lines'
   * dimensions; the justification rule is checked at signing.
   */
  recommend(
    ctx: RequestContext,
    id: string,
    input: RecommendationInput
  ): Promise<Omit<BidAnalysisDetail, 'steps'>> {
    assertManage(ctx);
    return this.deps.run(ctx, async (repos) => {
      const analysis = await this.locked(repos, id);
      assertVersion(analysis, input.expectedVersion);
      if (!WORKING.has(analysis.status)) {
        throw new AppError('INVALID_STATE', `A ${analysis.status} analysis cannot change`);
      }
      assertNotFrozen(analysis);
      if (input.lines && !analysis.splitAwardAllowed) {
        throw new AppError('SPLIT_AWARD_NOT_ALLOWED', 'This sourcing does not allow a split award');
      }
      const eventId = analysis.sourcingEventId;
      const lines = await repos.lines.list(eventId);
      const pairs =
        input.lines ?? lines.map((l) => ({ sourcingLineId: l.id, offerId: input.offerId! }));
      if (
        input.lines &&
        new Set(input.lines.map((l) => l.sourcingLineId)).size !== input.lines.length
      ) {
        throw new AppError('VALIDATION_ERROR', 'A line is recommended twice', [
          { field: 'lines', message: 'duplicate' },
        ]);
      }

      const results = await repos.results.list(id);
      for (const offerId of new Set(pairs.map((p) => p.offerId))) {
        const offer = await repos.offers.get(eventId, offerId);
        const result = results.find((r) => r.offerId === offerId && r.sourcingLineId === null);
        if (
          offer.status === 'disqualified' ||
          (result?.disqualified && !analysis.splitAwardAllowed)
        ) {
          throw new AppError('INVALID_STATE', 'A disqualified offer cannot be recommended');
        }
        if (offer.status !== 'logged' && offer.status !== 'late_accepted') {
          throw new AppError('INVALID_STATE', `A ${offer.status} offer cannot be recommended`);
        }
      }
      const written = await repos.awards.replace(id, pairs);
      if (written !== pairs.length) {
        throw new AppError(
          'VALIDATION_ERROR',
          'The recommended offer has no price for every line',
          [{ field: input.lines ? 'lines' : 'offerId', message: 'missing_price' }]
        );
      }

      // the awarded amount in the event currency, at the comparison rates
      const awards = await repos.awards.list(id);
      const rateOf = (c: string) => analysis.comparisonRates.find((r) => r.currency === c);
      const eventRate = rateOf(analysis.eventCurrency);
      let total = new Decimal(0);
      for (const a of awards) {
        const r = rateOf(a.currency);
        if (!r || !eventRate) {
          throw new AppError('EXCHANGE_RATE_MISSING', 'A comparison rate is missing', {
            currencies: [a.currency],
            date: analysis.eventOpenedAt?.slice(0, 10) ?? '',
          });
        }
        total = total.plus(convert(a.amount, r.rateToBase, eventRate.rateToBase));
      }
      const awardedAmount = total.toFixed(2);

      const justification = input.justification?.trim() || null;
      const criterionIds = input.justificationCriterionIds ?? [];
      const published = new Set((await repos.criteria.list(eventId)).map((c) => c.id));
      if (criterionIds.some((c) => !published.has(c))) {
        throw new AppError('VALIDATION_ERROR', "Justify with the event's published criteria", [
          { field: 'justificationCriterionIds', message: 'invalid_reference' },
        ]);
      }
      await repos.analyses.setRecommendation(id, {
        recommendedOfferId: input.offerId ?? null,
        justification,
        justificationCriterionIds: criterionIds,
        awardedAmount,
      });
      await repos.analyses.touch(id, input.expectedVersion);
      return this.detail(repos, id);
    });
  }

  /**
   * POST /bid-analyses/:id/sign — a committee signature. The recommendation must stand
   * (JUSTIFICATION_REQUIRED otherwise); the first signature freezes the results (FR-029).
   */
  sign(
    ctx: RequestContext,
    id: string,
    input: AnalysisSignInput
  ): Promise<Omit<BidAnalysisDetail, 'steps'>> {
    return this.deps.run(ctx, async (repos) => {
      const analysis = await this.locked(repos, id);
      assertVersion(analysis, input.expectedVersion);
      if (!WORKING.has(analysis.status) && analysis.status !== 'signing') {
        throw new AppError('INVALID_STATE', `A ${analysis.status} analysis takes no signature`);
      }
      const members = await repos.members.list(id);
      const me = members.find((m) => m.userId === ctx.userId && m.replacedById === null);
      if (!me) throw new AppError('FORBIDDEN', 'You are not on this committee');
      if (!me.eligible) {
        throw new AppError(
          'DECLARATION_REQUIRED',
          'Only a declared member without a conflict signs'
        );
      }
      if (me.signedAt) throw new AppError('INVALID_STATE', 'You have already signed');
      const minimum = await repos.analyses.committeeMinSize();
      const eligible = eligibleMembers(members).length;
      if (eligible < minimum) {
        throw new AppError('COMMITTEE_TOO_SMALL', 'Too few eligible committee members', {
          minimum,
          eligible,
        });
      }

      const awards = await repos.awards.list(id);
      if (awards.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'Record the recommendation before signing', [
          { field: 'recommendation', message: 'required' },
        ]);
      }
      const lineResults = (await repos.results.list(id)).filter((r) => r.sourcingLineId !== null);
      const split = analysis.recommendedOfferId === null;
      if (
        needsJustification(analysis, awards, lineResults, split) &&
        (!analysis.justification || analysis.justificationCriterionIds.length === 0)
      ) {
        throw new AppError(
          'JUSTIFICATION_REQUIRED',
          'Recommending other than the highest total needs a justification and a criterion'
        );
      }

      const actor = await this.actor(repos);
      await repos.signatures.insert({
        docId: id,
        stepId: null,
        cycle: Math.max(analysis.submissionCycle, 1),
        stepOrder: null,
        action: 'committee_sign',
        userName: actor.nameEn,
        userPosition: actor.position,
        comment: null,
        payload: { nameAr: actor.nameAr, function: me.function },
      });
      await repos.analyses.freeze(id);
      await repos.analyses.touch(id, input.expectedVersion);
      return this.detail(repos, id);
    });
  }

  /** POST /bid-analyses/:id/notices — unsuccessful supplier notices, after the award (FR-031). */
  recordNotices(
    ctx: RequestContext,
    id: string,
    input: NoticesInput
  ): Promise<Omit<BidAnalysisDetail, 'steps'>> {
    assertManage(ctx);
    return this.deps.run(ctx, async (repos) => {
      const analysis = await this.locked(repos, id);
      if (analysis.status !== 'approved') {
        throw new AppError('INVALID_STATE', 'Notices follow the approved award');
      }
      for (const notice of input.notices) {
        if (!(await repos.notices.record(id, notice))) {
          throw new AppError(
            'VALIDATION_ERROR',
            'The offer was awarded or is not in this analysis',
            [{ field: 'notices', message: 'invalid_reference' }]
          );
        }
      }
      return this.detail(repos, id);
    });
  }

  private async actor(repos: AnalysisRepos) {
    const [row] = await repos.tx.sql<
      { full_name_ar: string; full_name_en: string; position_title: string | null }[]
    >`
      select full_name_ar, full_name_en, position_title from public.membership
      where tenant_id = ${repos.ctx.tenantId} and user_id = ${repos.ctx.userId}`;
    if (!row) throw new AppError('FORBIDDEN', 'No membership in this organization');
    return { nameAr: row.full_name_ar, nameEn: row.full_name_en, position: row.position_title };
  }
}
