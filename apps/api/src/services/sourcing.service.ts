// RFQs from approved PR lines (002 US3, FR-013…FR-018, BR-22; research D4, R21). An event takes
// PR lines of one grant and one office, snapshots the procurement method the lines require (so
// later configuration edits never change it, US1-4), warns about split purchases (FR-053), and
// is issued only when its criteria total 100 per stage, enough approved suppliers are invited
// and the chosen method is not below the required one — unless an approved waiver covers the
// event. Each command is one tenant transaction that locks the event first, then its PR lines in
// id order; PR line and PR statuses move in the same transaction (FR-038).
import {
  DEFAULT_RFQ_CRITERIA,
  Decimal,
  METHOD_RANK,
  PERMISSIONS_002,
  estimatedValue,
  parseAmount,
  resolveProcurementMethod,
  type CreateRfqInput,
  type IssueRfqInput,
  type ListResponse,
  type MethodBand,
  type MethodLine,
  type ResolvedMethod,
  type RfqListQuery,
  type SourceablePrLine,
  type SourceablePrLinesQuery,
  type SourcingAction,
  type SourcingCriterionInput,
  type SourcingEventDetail,
  type SourcingEventSummary,
  type SourcingKind,
  type SourcingReasonInput,
  type SplittingWarning,
  type UpdateRfqInput,
} from '@ngo/shared';
import { withTenantTx, type TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import { DocSignatureRepository } from '../repositories/doc-signature.repository';
import { MethodBandRepository } from '../repositories/method-band.repository';
import { NumberingRepository } from '../repositories/numbering.repository';
import { ProcurementSettingRepository } from '../repositories/procurement-setting.repository';
import { SourcingCriterionRepository } from '../repositories/sourcing-criterion.repository';
import {
  SourcingEventRepository,
  type SourcingEventRecord,
  type SourcingPrLine,
} from '../repositories/sourcing-event.repository';
import { SourcingInvitationRepository } from '../repositories/sourcing-invitation.repository';
import { SourcingLineRepository } from '../repositories/sourcing-line.repository';
import { WaiverRepository } from '../repositories/waiver.repository';
import type { RequestContext } from '../types/context';
import { ensureTenantSeeds } from './doc-adapters/binding';
import { NumberingService, numberingTxStore } from './numbering.service';

export interface SourcingRepos {
  tx: TenantTx;
  ctx: RequestContext;
  events: SourcingEventRepository;
  lines: SourcingLineRepository;
  criteria: SourcingCriterionRepository;
  invitations: SourcingInvitationRepository;
  waivers: WaiverRepository;
  bands: MethodBandRepository;
  settings: ProcurementSettingRepository;
  signatures(docType: 'RFQ' | 'TND'): DocSignatureRepository;
  assignNumber(
    docType: 'RFQ' | 'TND',
    officeId: string,
    at: Date,
    timeZone: string
  ): Promise<string>;
}

export interface SourcingServiceDeps {
  run<T>(ctx: RequestContext, fn: (repos: SourcingRepos) => Promise<T>): Promise<T>;
}

export const defaultSourcingDeps: SourcingServiceDeps = {
  run: (ctx, fn) =>
    withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, async (tx) => {
      await ensureTenantSeeds(tx);
      const numbering = new NumberingService(
        new NumberingRepository(ctx),
        numberingTxStore(ctx.tenantId)
      );
      return fn({
        tx,
        ctx,
        events: new SourcingEventRepository(tx.sql, ctx.tenantId),
        lines: new SourcingLineRepository(tx.sql, ctx.tenantId),
        criteria: new SourcingCriterionRepository(tx.sql, ctx.tenantId),
        invitations: new SourcingInvitationRepository(tx.sql, ctx.tenantId),
        waivers: new WaiverRepository(tx.sql, ctx.tenantId),
        bands: new MethodBandRepository(tx.sql, ctx.tenantId),
        settings: new ProcurementSettingRepository(tx.sql, ctx.tenantId),
        signatures: (docType) => new DocSignatureRepository(tx.sql, ctx.tenantId, docType),
        assignNumber: (docType, officeId, at, timeZone) =>
          numbering.assignNumber(tx.sql, docType, officeId, at, timeZone),
      });
    }),
};

const SOURCEABLE_PR_STATUSES = new Set(['approved', 'in_procurement']);
/** Statuses an event can be cancelled or re-issued from (before the award). */
const LIVE_STATUSES = new Set(['issued', 'closed', 'opened', 'evaluated']);

export const docTypeOf = (kind: SourcingKind): 'RFQ' | 'TND' => (kind === 'rfq' ? 'RFQ' : 'TND');

function methodLine(l: SourcingPrLine): MethodLine {
  // approved PRs always carry their locked rates (001 R7)
  if (l.lineTotal === null || l.rateToBase === null || l.doaRateToBase === null) {
    throw new AppError('INVALID_STATE', 'The PR has no locked exchange rates');
  }
  return { lineTotal: l.lineTotal, rateToBase: l.rateToBase, doaRateToBase: l.doaRateToBase };
}

/** The band of the set that decided the required method (the stricter one). */
function decidingBand(resolved: ResolvedMethod): MethodBand {
  const { tenant, grant } = resolved.bandsUsed;
  return grant && METHOD_RANK[grant.method] > METHOD_RANK[tenant.method] ? grant : tenant;
}

/**
 * The anti-splitting warning (research D4, FR-053): the selection plus related lines already in
 * events of the same or a lower method exceed the band's maximum. Never a block.
 */
export async function splittingWarningFor(
  repos: Pick<SourcingRepos, 'events' | 'settings'>,
  lines: readonly SourcingPrLine[],
  resolved: ResolvedMethod,
  excludeEventId: string | null
): Promise<SplittingWarning | null> {
  const band = decidingBand(resolved);
  if (band.maxAmount === null) return null;
  const first = lines[0]!;
  const { splittingWindowDays } = await repos.settings.get();
  const candidates = await repos.events.splittingCandidates({
    prLineIds: lines.map((l) => l.id),
    grantId: first.grantId!,
    officeId: first.officeId!,
    categories: [...new Set(lines.map((l) => l.budgetCategory).filter((c): c is string => !!c))],
    prDates: [...new Set(lines.map((l) => l.prDate).filter((d): d is string => !!d))],
    windowDays: splittingWindowDays,
    maxRank: METHOD_RANK[resolved.requiredMethod],
    excludeEventId,
  });
  if (candidates.length === 0) return null;
  const total = estimatedValue([...lines.map(methodLine), ...candidates]);
  if (!parseAmount(total).gt(parseAmount(band.maxAmount))) return null;
  return {
    prIds: [...new Set([...lines.map((l) => l.prId), ...candidates.map((c) => c.prId)])],
    total,
    bandMax: new Decimal(band.maxAmount).toFixed(2),
  };
}

/** One grant, one office, approved PRs (US3-5). */
function assertSourceable(lines: readonly SourcingPrLine[], ids: readonly string[]): void {
  if (lines.length !== ids.length) throw new AppError('NOT_FOUND', 'PR line not found');
  if (lines.some((l) => !SOURCEABLE_PR_STATUSES.has(l.prStatus))) {
    throw new AppError('INVALID_STATE', 'Only lines of approved PRs can be sourced');
  }
  const grants = new Set(lines.map((l) => l.grantId));
  const offices = new Set(lines.map((l) => l.officeId));
  if (grants.size > 1 || offices.size > 1 || lines.some((l) => !l.grantId || !l.officeId)) {
    throw new AppError('MIXED_GRANTS', 'The PR lines belong to different grants or offices');
  }
}

function assertVersion(current: { version: number }, expected: number): void {
  if (current.version !== expected) {
    throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
  }
}

/** Σ weight per stage = 100.00 (FR-017, US3-2). */
export function criteriaWeightIssue(
  criteria: readonly { stage: string; kind: string; weightPct: string | null }[]
): { stage: string; total: string } | null {
  const totals = new Map<string, Decimal>();
  for (const c of criteria) {
    if (c.kind !== 'weighted' || c.weightPct === null) continue;
    totals.set(c.stage, (totals.get(c.stage) ?? new Decimal(0)).plus(parseAmount(c.weightPct)));
  }
  if (totals.size === 0) return { stage: 'single', total: '0.00' };
  for (const [stage, total] of totals) {
    if (!total.eq(100)) return { stage, total: total.toFixed(2) };
  }
  return null;
}

export class SourcingService {
  constructor(
    private readonly kind: SourcingKind = 'rfq',
    private readonly deps: SourcingServiceDeps = defaultSourcingDeps
  ) {}

  private get docType() {
    return docTypeOf(this.kind);
  }

  // --- reads ---------------------------------------------------------------------------------

  sourceablePrLines(
    ctx: RequestContext,
    query: SourceablePrLinesQuery
  ): Promise<SourceablePrLine[]> {
    return this.deps.run(ctx, ({ events }) => events.sourceablePrLines(query));
  }

  list(ctx: RequestContext, query: RfqListQuery): Promise<ListResponse<SourcingEventSummary>> {
    const { page, pageSize, sort, ...filters } = query;
    return this.deps.run(ctx, ({ events }) =>
      events.list({ kind: this.kind, page, pageSize, sort, ...filters })
    );
  }

  get(ctx: RequestContext, id: string): Promise<SourcingEventDetail> {
    return this.deps.run(ctx, (repos) => this.detail(repos, id));
  }

  /** The event with its lines, criteria, invitations and the caller's actions. */
  async detail(repos: SourcingRepos, id: string): Promise<SourcingEventDetail> {
    const event = await repos.events.get(id, this.kind);
    const [lines, criteria, invitations, acknowledged] = await Promise.all([
      repos.lines.list(id),
      repos.criteria.list(id),
      repos.invitations.list(id),
      repos.events.splittingAcknowledged(id, this.docType),
    ]);
    const { methodSnapshot, requiredMinQuotations, ...header } = event;
    return {
      ...header,
      method: {
        requiredMethod: event.requiredMethod,
        requiredMinQuotations,
        chosenMethod: event.chosenMethod,
        estimatedValue: event.estimatedValueDoa,
        currency: event.doaCurrency,
        bandsUsed: methodSnapshot,
      },
      splittingAcknowledged: acknowledged,
      lines,
      criteria,
      invitations,
      offers: [],
      opening: null,
      analysisId: null,
      availableActions: this.actionsFor(repos.ctx, event),
    };
  }

  actionsFor(ctx: RequestContext, event: SourcingEventRecord): SourcingAction[] {
    const create = ctx.permissions.has(PERMISSIONS_002.RFQ_CREATE);
    const actions: SourcingAction[] = [];
    if (event.status === 'draft') {
      if (create) actions.push('edit', 'cancel');
      if (ctx.permissions.has(PERMISSIONS_002.RFQ_ISSUE)) actions.push('issue');
    }
    if (LIVE_STATUSES.has(event.status) && create) actions.push('cancel', 'reissue');
    return actions;
  }

  // --- create --------------------------------------------------------------------------------

  /**
   * POST /rfqs — PR lines of one grant and office, none already in an open event; the method is
   * resolved from the PRs' locked rates and snapshotted; lines become in_sourcing and their PRs
   * in_procurement.
   */
  create(ctx: RequestContext, input: CreateRfqInput): Promise<SourcingEventDetail> {
    const ids = [...new Set(input.prLineIds)];
    return this.deps.run(ctx, async (repos) => {
      const prLines = await repos.events.prLines(ids);
      assertSourceable(prLines, ids);
      await this.assertLinesFree(repos, ids);

      const first = prLines[0]!;
      const facts = await repos.events.tenantFacts();
      const resolved = await this.resolve(repos, prLines, first.grantId!);
      const splittingWarning = await splittingWarningFor(repos, prLines, resolved, null);

      // keep the PR's order: the caller's selection order
      const ordered = ids.map((id) => prLines.find((l) => l.id === id)!);
      const eventId = await repos.events.insert({
        kind: this.kind,
        title: input.title,
        grantId: first.grantId!,
        officeId: first.officeId!,
        currency: input.currency ?? first.currency,
        issueDate: input.issueDate ?? null,
        submissionDeadline: input.submissionDeadline ?? null,
        deliveryPlace: input.deliveryPlace ?? null,
        deliveryTerms: input.deliveryTerms ?? null,
        paymentTerms: input.paymentTerms ?? null,
        offerValidityDays: input.offerValidityDays ?? null,
        splitAwardAllowed: input.splitAwardAllowed ?? false,
        requiredMethod: resolved.requiredMethod,
        requiredMinQuotations: resolved.minQuotations,
        chosenMethod: resolved.requiredMethod,
        estimatedValueDoa: resolved.estimatedValue,
        doaCurrency: facts.doaCurrency,
        methodSnapshot: resolved.bandsUsed,
        splittingWarning,
      });
      await repos.lines.insertMany(
        eventId,
        ordered.map((l) => ({
          prLineId: l.id,
          description: l.description,
          specifications: l.specifications,
        }))
      );
      await repos.criteria.replace(eventId, DEFAULT_RFQ_CRITERIA);
      await repos.events.setPrLineStatus(ids, 'in_sourcing');
      await repos.events.refreshPrStatuses([...new Set(prLines.map((l) => l.prId))]);
      return this.detail(repos, eventId);
    });
  }

  private async assertLinesFree(repos: SourcingRepos, ids: readonly string[]): Promise<void> {
    const open = await repos.events.openEventFor(ids);
    if (open) {
      throw new AppError('PR_LINE_ALREADY_SOURCING', 'A PR line is already in an open sourcing', {
        prLineIds: open.prLineIds,
        eventId: open.eventId,
      });
    }
  }

  private async resolve(
    repos: SourcingRepos,
    prLines: readonly SourcingPrLine[],
    grantId: string
  ): Promise<ResolvedMethod> {
    const [tenantBands, grantBands] = await Promise.all([
      repos.bands.listTenant(),
      repos.bands.listGrant(grantId),
    ]);
    return resolveProcurementMethod({ lines: prLines.map(methodLine), tenantBands, grantBands });
  }

  // --- draft edits ---------------------------------------------------------------------------

  /** PATCH /rfqs/:id — header, line wording, criteria and invitations while draft. */
  update(ctx: RequestContext, id: string, input: UpdateRfqInput): Promise<SourcingEventDetail> {
    const { expectedVersion, lines, criteria, invitations, ...header } = input;
    return this.deps.run(ctx, async (repos) => {
      const current = await repos.events.lock(id, this.kind);
      assertVersion(current, expectedVersion);
      if (current.status !== 'draft') {
        throw new AppError('INVALID_STATE', 'Only a draft can be edited');
      }
      await repos.events.update(id, header, expectedVersion);
      for (const line of lines ?? []) {
        if (!(await repos.lines.reword(id, line.id, line))) {
          throw new AppError('NOT_FOUND', 'Sourcing line not found');
        }
      }
      if (criteria) await repos.criteria.replace(id, criteria as SourcingCriterionInput[]);
      if (invitations) {
        const { today } = await repos.events.tenantFacts();
        await repos.invitations.replace(id, invitations, today);
      }
      return this.detail(repos, id);
    });
  }

  // --- issue ---------------------------------------------------------------------------------

  /**
   * POST /rfqs/:id/issue — every data-model §4 guard, then the RFQ number (research D7). The
   * splitting acknowledgement, when needed, is signed with its comment.
   */
  issue(ctx: RequestContext, id: string, input: IssueRfqInput): Promise<SourcingEventDetail> {
    return this.deps.run(ctx, async (repos) => {
      const current = await repos.events.lock(id, this.kind);
      assertVersion(current, input.expectedVersion);
      if (current.status !== 'draft') {
        throw new AppError('INVALID_STATE', 'Only a draft can be issued');
      }
      const event = await repos.events.get(id, this.kind);
      const facts = await repos.events.tenantFacts();
      const issueDate = event.issueDate ?? facts.today;
      if (!event.submissionDeadline) {
        throw new AppError('VALIDATION_ERROR', 'The submission deadline is required', [
          { field: 'submissionDeadline', message: 'required' },
        ]);
      }
      if (Date.parse(event.submissionDeadline) <= Date.parse(`${issueDate}T00:00:00Z`)) {
        throw new AppError('VALIDATION_ERROR', 'The deadline must be after the issue date', [
          { field: 'submissionDeadline', message: 'before_issue_date' },
        ]);
      }

      const weightIssue = criteriaWeightIssue(await repos.criteria.list(id));
      if (weightIssue) {
        throw new AppError(
          'CRITERIA_WEIGHTS_INVALID',
          'Criteria weights must total 100 per stage',
          weightIssue
        );
      }

      const required = event.requiredMinQuotations;
      const invited = await repos.invitations.countApproved(id);
      if (
        invited < required &&
        !(await repos.waivers.hasApprovedWaiver(this.docType, id, [
          'fewer_quotations',
          'single_source',
        ]))
      ) {
        throw new AppError('TOO_FEW_SUPPLIERS', 'Too few approved suppliers are invited', {
          required,
          actual: invited,
        });
      }

      if (
        METHOD_RANK[event.chosenMethod] < METHOD_RANK[event.requiredMethod] &&
        !(await repos.waivers.hasApprovedWaiver(this.docType, id, ['lower_method', 'emergency']))
      ) {
        throw new AppError('METHOD_BELOW_REQUIRED', 'The chosen method is below the required one', {
          required: event.requiredMethod,
          chosen: event.chosenMethod,
          estimatedValue: event.estimatedValueDoa,
          currency: event.doaCurrency,
        });
      }

      const actor = await this.actorSnapshot(repos);
      const signatures = repos.signatures(this.docType);
      if (event.splittingWarning) {
        const comment = input.splittingAcknowledgement?.comment?.trim();
        if (!comment) {
          throw new AppError(
            'SPLITTING_ACK_REQUIRED',
            'The splitting warning must be acknowledged with a comment',
            event.splittingWarning
          );
        }
        await signatures.insert({
          docId: id,
          stepId: null,
          cycle: 1,
          stepOrder: null,
          action: 'acknowledge_warning',
          userName: actor.nameEn,
          userPosition: actor.position,
          comment,
          payload: { warning: event.splittingWarning, nameAr: actor.nameAr },
        });
      }

      const number = await repos.assignNumber(
        this.docType,
        event.officeId,
        new Date(),
        facts.timeZone
      );
      await repos.events.markIssued(id, number, issueDate);
      await signatures.insert({
        docId: id,
        stepId: null,
        cycle: 1,
        stepOrder: null,
        action: 'submit',
        userName: actor.nameEn,
        userPosition: actor.position,
        comment: null,
        payload: { number, nameAr: actor.nameAr, issued: true },
      });
      return this.detail(repos, id);
    });
  }

  // --- cancel and re-issue -------------------------------------------------------------------

  /** POST /rfqs/:id/cancel — PR lines go back to not_sourced (their PRs back to approved). */
  cancel(
    ctx: RequestContext,
    id: string,
    input: SourcingReasonInput
  ): Promise<SourcingEventDetail> {
    return this.deps.run(ctx, async (repos) => {
      const current = await repos.events.lock(id, this.kind);
      assertVersion(current, input.expectedVersion);
      if (current.status !== 'draft' && !LIVE_STATUSES.has(current.status)) {
        throw new AppError('INVALID_STATE', `A ${current.status} event cannot be cancelled`);
      }
      await this.cancelIn(repos, id, input.reason);
      const prLineIds = await repos.lines.prLineIds(id);
      const prLines = await repos.events.prLines(prLineIds);
      await repos.events.setPrLineStatus(prLineIds, 'not_sourced');
      await repos.events.refreshPrStatuses([...new Set(prLines.map((l) => l.prId))]);
      return this.detail(repos, id);
    });
  }

  private async cancelIn(repos: SourcingRepos, id: string, reason: string): Promise<void> {
    const actor = await this.actorSnapshot(repos);
    await repos.tx.setAuditComment(reason);
    await repos.events.markCancelled(id, reason);
    await repos.signatures(this.docType).insert({
      docId: id,
      stepId: null,
      cycle: 1,
      stepOrder: null,
      action: 'cancel',
      userName: actor.nameEn,
      userPosition: actor.position,
      comment: reason,
      payload: { nameAr: actor.nameAr },
    });
  }

  /**
   * POST /rfqs/:id/reissue (FR-022) — the event is cancelled (`reissued: …`) and a new draft takes
   * its lines, header, criteria and invitations, linked by reissued_from_id. The method snapshot
   * is kept: the lines and their locked rates are the same.
   */
  reissue(
    ctx: RequestContext,
    id: string,
    input: SourcingReasonInput
  ): Promise<SourcingEventDetail> {
    return this.deps.run(ctx, async (repos) => {
      const current = await repos.events.lock(id, this.kind);
      assertVersion(current, input.expectedVersion);
      if (!LIVE_STATUSES.has(current.status)) {
        throw new AppError('INVALID_STATE', `A ${current.status} event cannot be re-issued`);
      }
      const event = await repos.events.get(id, this.kind);
      const [lines, criteria, invitations] = await Promise.all([
        repos.lines.list(id),
        repos.criteria.list(id),
        repos.invitations.inputs(id),
      ]);
      await this.cancelIn(repos, id, `reissued: ${input.reason}`);

      const newId = await repos.events.insert({
        kind: this.kind,
        title: event.title,
        grantId: event.grantId,
        officeId: event.officeId,
        currency: event.currency,
        deliveryPlace: event.deliveryPlace,
        deliveryTerms: event.deliveryTerms,
        paymentTerms: event.paymentTerms,
        offerValidityDays: event.offerValidityDays,
        splitAwardAllowed: event.splitAwardAllowed,
        requiredMethod: event.requiredMethod,
        requiredMinQuotations: event.requiredMinQuotations,
        chosenMethod: event.chosenMethod,
        estimatedValueDoa: event.estimatedValueDoa,
        doaCurrency: event.doaCurrency,
        methodSnapshot: event.methodSnapshot,
        splittingWarning: event.splittingWarning,
        reissuedFromId: id,
      });
      await repos.lines.insertMany(
        newId,
        lines.map((l) => ({
          prLineId: l.prLineId,
          description: l.description,
          specifications: l.specifications,
        }))
      );
      await repos.criteria.replace(
        newId,
        criteria.map((c) => ({
          stage: c.stage,
          kind: c.kind,
          code: c.code,
          nameAr: c.nameAr,
          nameEn: c.nameEn,
          weightPct: c.weightPct,
          isPrice: c.isPrice,
        }))
      );
      const { today } = await repos.events.tenantFacts();
      await repos.invitations.replace(newId, invitations, today);
      return this.detail(repos, newId);
    });
  }

  // -------------------------------------------------------------------------------------------

  private async actorSnapshot(repos: SourcingRepos) {
    const [row] = await repos.tx.sql<
      { full_name_ar: string; full_name_en: string; position_title: string | null }[]
    >`
      select full_name_ar, full_name_en, position_title from public.membership
      where tenant_id = ${repos.ctx.tenantId} and user_id = ${repos.ctx.userId}`;
    if (!row) throw new AppError('FORBIDDEN', 'No membership in this organization');
    return { nameAr: row.full_name_ar, nameEn: row.full_name_en, position: row.position_title };
  }
}
