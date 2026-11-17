// Purchase orders and contracts from the award (002 US6, FR-032–FR-038; research D2, R23). An
// approved analysis gives one draft per awarded supplier whose supplier, lines, prices, grant,
// budget lines, locations and activities are inherited and never writable; only the terms are
// edited before submission. Approval (doc-adapters/po.adapter.ts) converts the PR commitment of
// the ordered lines into the PO commitment. After approval the PO is acknowledged by the
// supplier, received (receipt.service.ts) and closed — automatically when fully received and
// paid, or manually with a reason, which releases what it still holds.
import {
  Decimal,
  PERMISSIONS_002,
  amountInWords,
  convert,
  parseAmount,
  type CreatePosInput,
  type CurrencyNames,
  type ListResponse,
  type PoAcknowledgeInput,
  type PoBudgetEffect,
  type PoCloseInput,
  type PoListQuery,
  type PoPatchInput,
  type PoVersionView,
  type PurchaseOrderDetail,
  type PurchaseOrderStatus,
  type PurchaseOrderSummary,
} from '@ngo/shared';
import { withTenantTx, type TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import { BidAnalysisRepository } from '../repositories/bid-analysis.repository';
import { PoLineRepository } from '../repositories/po-line.repository';
import { PoVersionRepository } from '../repositories/po-version.repository';
import {
  PurchaseOrderRepository,
  type PoPatchColumns,
  type PurchaseOrderRecord,
} from '../repositories/purchase-order.repository';
import { SourceCommitmentRepository } from '../repositories/source-commitment.repository';
import { SourcingEventRepository } from '../repositories/sourcing-event.repository';
import type { RequestContext } from '../types/context';
import { BudgetService } from './budget.service';
import { ensureTenantSeeds } from './doc-adapters/binding';
import { ExchangeRateService } from './exchange-rate.service';

export interface PoRepos {
  tx: TenantTx;
  ctx: RequestContext;
  pos: PurchaseOrderRepository;
  lines: PoLineRepository;
  versions: PoVersionRepository;
  analyses: BidAnalysisRepository;
  events: SourcingEventRepository;
  sources: SourceCommitmentRepository;
  rates: ExchangeRateService;
  budget: BudgetService;
}

export interface PurchaseOrderServiceDeps {
  run<T>(ctx: RequestContext, fn: (repos: PoRepos) => Promise<T>): Promise<T>;
}

export function poRepos(tx: TenantTx, ctx: RequestContext): PoRepos {
  const t = ctx.tenantId;
  return {
    tx,
    ctx,
    pos: new PurchaseOrderRepository(tx.sql, t),
    lines: new PoLineRepository(tx.sql, t),
    versions: new PoVersionRepository(tx.sql, t),
    analyses: new BidAnalysisRepository(tx.sql, t),
    events: new SourcingEventRepository(tx.sql, t),
    sources: new SourceCommitmentRepository(t),
    rates: ExchangeRateService.forContext(ctx),
    budget: BudgetService.forContext(ctx),
  };
}

export const defaultPoDeps: PurchaseOrderServiceDeps = {
  run: (ctx, fn) =>
    withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, async (tx) => {
      await ensureTenantSeeds(tx);
      return fn(poRepos(tx, ctx));
    }),
};

/** Statuses in which the terms may be edited. */
const EDITABLE = new Set<PurchaseOrderStatus>(['draft', 'returned']);
/** Approved and not yet closed: the PO holds a commitment. */
export const PO_OPEN_STATUSES = new Set<PurchaseOrderStatus>([
  'approved',
  'acknowledged',
  'partially_received',
  'fully_received',
]);

const PATCH_COLUMNS: Record<Exclude<keyof PoPatchInput, 'expectedVersion'>, keyof PoPatchColumns> =
  {
    poDate: 'po_date',
    deliveryAddress: 'delivery_address',
    deliverySchedule: 'delivery_schedule',
    deliveryTerms: 'delivery_terms',
    paymentTermsText: 'payment_terms_text',
    specialConditions: 'special_conditions',
    advancePct: 'advance_pct',
    retentionPct: 'retention_pct',
    retentionReleaseDate: 'retention_release_date',
    isService: 'is_service',
    scopeText: 'scope_text',
    startDate: 'start_date',
    endDate: 'end_date',
  };

function assertVersion(current: { version: number }, expected: number): void {
  if (current.version !== expected) {
    throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
  }
}

function assertPermission(ctx: RequestContext, permission: (typeof PERMISSIONS_002)[keyof typeof PERMISSIONS_002]) {
  if (!ctx.permissions.has(permission)) {
    throw new AppError('FORBIDDEN', `Missing permission ${permission}`);
  }
}

/**
 * The PO's receipt status from its lines: every line fully accepted → fully_received, some
 * acceptance → partially_received, otherwise acknowledged / approved (research R24). Returns the
 * new status when it changed.
 */
export async function refreshReceiptStatus(
  repos: Pick<PoRepos, 'pos' | 'lines'>,
  po: PurchaseOrderRecord
): Promise<PurchaseOrderStatus | null> {
  if (!PO_OPEN_STATUSES.has(po.status)) return null;
  const lines = await repos.lines.list(po.id);
  const accepted = lines.some((l) => parseAmount(l.acceptedQty).gt(0));
  const full = lines.length > 0 && lines.every((l) => parseAmount(l.remainingQty).isZero());
  const next: PurchaseOrderStatus = full
    ? 'fully_received'
    : accepted
      ? 'partially_received'
      : po.acknowledgedAt
        ? 'acknowledged'
        : 'approved';
  if (next === po.status) return null;
  await repos.pos.setStatus(po.id, next);
  return next;
}

export class PurchaseOrderService {
  constructor(private readonly deps: PurchaseOrderServiceDeps = defaultPoDeps) {}

  // --- reads ---------------------------------------------------------------------------------

  list(ctx: RequestContext, query: PoListQuery): Promise<ListResponse<PurchaseOrderSummary>> {
    return this.deps.run(ctx, ({ pos }) =>
      pos.list({
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        kind: query.kind,
        bidAnalysisId: query.bidAnalysisId,
        receivable: query.receivable,
      })
    );
  }

  /** The PO without the workflow steps (added by the route from the engine). */
  get(ctx: RequestContext, id: string): Promise<Omit<PurchaseOrderDetail, 'steps'>> {
    return this.deps.run(ctx, (repos) => this.detail(repos, id));
  }

  async detail(repos: PoRepos, id: string): Promise<Omit<PurchaseOrderDetail, 'steps'>> {
    const po = await repos.pos.get(id);
    const [lines, requireAck, names, grns, rating, effect] = await Promise.all([
      repos.lines.list(id),
      repos.pos.requireAcknowledgement(),
      this.currencyNames(repos, po.currency),
      repos.tx.sql<{ id: string; number: string; status: string; received_date: string }[]>`
        select id, number, status, received_date::text from public.grn
        where tenant_id = ${repos.ctx.tenantId} and po_id = ${id}
        order by created_at`,
      repos.tx.sql<
        { on_time: number; quality: number; documentation: number; comment: string | null }[]
      >`
        select on_time, quality, documentation, comment from public.supplier_rating
        where tenant_id = ${repos.ctx.tenantId} and po_id = ${id}`,
      this.budgetEffect(repos, po),
    ]);
    const words = (locale: 'ar' | 'en') =>
      names ? amountInWords(po.totalWithAmendments, names, locale) : null;

    return {
      ...po,
      totalInWordsAr: words('ar'),
      totalInWordsEn: words('en'),
      requireAcknowledgement: requireAck,
      lines,
      budgetEffect: effect,
      grns: grns.map((g) => ({
        id: g.id,
        number: g.number,
        status: g.status,
        receivedDate: g.received_date,
      })),
      rating: rating[0]
        ? {
            onTime: rating[0].on_time,
            quality: rating[0].quality,
            documentation: rating[0].documentation,
            comment: rating[0].comment,
          }
        : null,
      availableActions: this.actionsFor(repos.ctx, po, requireAck, rating.length > 0),
    };
  }

  actionsFor(
    ctx: RequestContext,
    po: PurchaseOrderRecord,
    requireAck: boolean,
    rated: boolean
  ): string[] {
    const actions: string[] = [];
    const can = (p: (typeof PERMISSIONS_002)[keyof typeof PERMISSIONS_002]) =>
      ctx.permissions.has(p);
    if (EDITABLE.has(po.status) && can(PERMISSIONS_002.PO_CREATE)) actions.push('edit');
    if (po.status === 'approved' && can(PERMISSIONS_002.PO_CREATE)) actions.push('acknowledge');
    if (PO_OPEN_STATUSES.has(po.status) && can(PERMISSIONS_002.PO_CLOSE)) actions.push('close');
    const receivable =
      (po.status === 'approved' && (!requireAck || po.acknowledgedAt !== null)) ||
      po.status === 'acknowledged' ||
      po.status === 'partially_received';
    if (receivable && po.kind === 'po' && !po.isService && can(PERMISSIONS_002.GRN_CREATE)) {
      actions.push('receive');
    }
    if (
      (po.status === 'fully_received' || po.status === 'closed') &&
      !rated &&
      (can(PERMISSIONS_002.PO_CREATE) || can(PERMISSIONS_002.GRN_CREATE))
    ) {
      actions.push('rate');
    }
    return actions;
  }

  /**
   * Per budget line: what the ordered PR lines committed and the PO amount in the grant
   * currency — locked amounts once approved, today's rates before. Empty when a rate is missing.
   */
  private async budgetEffect(repos: PoRepos, po: PurchaseOrderRecord): Promise<PoBudgetEffect[]> {
    const [amounts, prRows, lines] = await Promise.all([
      repos.lines.byBudgetLine(po.id),
      repos.lines.prCommitments(po.id),
      repos.lines.list(po.id),
    ]);
    if (amounts.length === 0) return [];

    const poInGrant = new Map<string, Decimal>();
    if (po.commitRateToBase) {
      for (const l of lines) {
        const current = poInGrant.get(l.budgetLineId) ?? new Decimal(0);
        poInGrant.set(l.budgetLineId, current.plus(parseAmount(l.amountGrant ?? '0')));
      }
    } else {
      const facts = await repos.events.tenantFacts();
      let rates;
      try {
        rates = await repos.rates.resolveRates(repos.tx, [po.currency, po.grantCurrency], facts.today);
      } catch {
        return [];
      }
      const from = rates.get(po.currency)!.rateToBase;
      const to = rates.get(po.grantCurrency)!.rateToBase;
      for (const a of amounts) {
        poInGrant.set(a.budgetLineId, parseAmount(convert(a.amount, from, to)));
      }
    }

    const ids = amounts.map((a) => a.budgetLineId);
    const balances = await repos.tx.sql<{ budget_line_id: string; code: string; available: string }[]>`
      select v.budget_line_id, b.code, v.available::text
      from public.budget_line_balance v
      join public.budget_line b on b.id = v.budget_line_id
      where v.budget_line_id in ${repos.tx.sql(ids)}`;
    return amounts.map((a) => {
      const balance = balances.find((b) => b.budget_line_id === a.budgetLineId);
      const pr = prRows
        .filter((r) => r.budgetLineId === a.budgetLineId)
        .reduce((sum, r) => sum.plus(parseAmount(r.amountGrant)), new Decimal(0));
      const poAmount = poInGrant.get(a.budgetLineId) ?? new Decimal(0);
      return {
        budgetLineId: a.budgetLineId,
        code: balance?.code ?? '',
        currency: po.grantCurrency,
        prCommitted: pr.toFixed(2),
        poAmount: poAmount.toFixed(2),
        difference: poAmount.minus(pr).toFixed(2),
        available: balance?.available ?? '0.00',
      };
    });
  }

  private async currencyNames(repos: PoRepos, code: string): Promise<CurrencyNames | null> {
    const [row] = await repos.tx.sql<CurrencyNames[]>`
      select code::text as "code", minor_units as "minorUnits",
             name_ar_singular as "nameArSingular", name_ar_dual as "nameArDual",
             name_ar_plural as "nameArPlural", name_en_singular as "nameEnSingular",
             name_en_plural as "nameEnPlural", minor_name_ar_singular as "minorNameArSingular",
             minor_name_ar_dual as "minorNameArDual", minor_name_ar_plural as "minorNameArPlural",
             minor_name_en_singular as "minorNameEnSingular",
             minor_name_en_plural as "minorNameEnPlural"
      from public.currency where code = ${code}`;
    return row ? { ...row } : null;
  }

  versions(ctx: RequestContext, id: string): Promise<Omit<PoVersionView, 'snapshot'>[]> {
    return this.deps.run(ctx, async ({ pos, versions }) => {
      await pos.get(id);
      return versions.list(id);
    });
  }

  version(ctx: RequestContext, id: string, v: number): Promise<PoVersionView> {
    return this.deps.run(ctx, async ({ pos, versions }) => {
      await pos.get(id);
      const found = await versions.get(id, v);
      if (!found) throw new AppError('NOT_FOUND', 'Version not found');
      return found;
    });
  }

  // --- create and edit -----------------------------------------------------------------------

  /**
   * POST /bid-analyses/:id/pos — one draft per awarded supplier that has no live PO yet (FR-032).
   * Kind: explicit `contract`, otherwise a PO; a PO whose awarded lines all come from services
   * PRs is a service PO (completion certificate instead of GRNs, R23).
   */
  createFromAnalysis(
    ctx: RequestContext,
    analysisId: string,
    input: CreatePosInput
  ): Promise<PurchaseOrderSummary[]> {
    assertPermission(ctx, PERMISSIONS_002.PO_CREATE);
    return this.deps.run(ctx, async (repos) => {
      const analysis = await repos.analyses.get(analysisId, { lock: true });
      if (analysis.status !== 'approved') {
        throw new AppError('INVALID_STATE', 'Purchase orders are created from an approved award');
      }
      const existing = new Set((await repos.pos.liveForAnalysis(analysisId)).map((p) => p.supplierId));
      const suppliers = (await repos.pos.awardedSuppliers(analysisId)).filter(
        (s) => !existing.has(s.supplierId)
      );
      if (suppliers.length === 0) {
        throw new AppError('INVALID_STATE', 'Every awarded supplier already has a purchase order');
      }
      const facts = await repos.events.tenantFacts();
      const created: string[] = [];
      for (const s of suppliers) {
        const id = await repos.pos.insertFromAward({
          analysisId,
          supplierId: s.supplierId,
          kind: input.kind ?? 'po',
          currency: s.currency,
          isService: s.allServices,
          poDate: facts.today,
        });
        await repos.lines.insertFromAward(id, analysisId, s.supplierId);
        created.push(id);
      }
      const summaries: PurchaseOrderSummary[] = [];
      for (const id of created) {
        const po = await repos.pos.get(id);
        summaries.push({
          id: po.id,
          kind: po.kind,
          docType: po.docType,
          number: po.number,
          status: po.status,
          supplierId: po.supplierId,
          supplierNameAr: po.supplierNameAr,
          supplierNameEn: po.supplierNameEn,
          bidAnalysisId: po.bidAnalysisId,
          analysisNumber: po.analysisNumber,
          currency: po.currency,
          totalWithAmendments: po.totalWithAmendments,
          poDate: po.poDate,
          createdAt: po.createdAt,
        });
      }
      return summaries;
    });
  }

  /** PATCH /pos/:id — the terms only, while draft or returned. */
  patch(ctx: RequestContext, id: string, input: PoPatchInput): Promise<Omit<PurchaseOrderDetail, 'steps'>> {
    assertPermission(ctx, PERMISSIONS_002.PO_CREATE);
    return this.deps.run(ctx, async (repos) => {
      const po = await repos.pos.get(id, { lock: true });
      assertVersion(po, input.expectedVersion);
      if (!EDITABLE.has(po.status)) {
        throw new AppError('INVALID_STATE', 'Only a draft or returned purchase order can be edited');
      }
      const changes: PoPatchColumns = {};
      for (const [field, column] of Object.entries(PATCH_COLUMNS) as [
        keyof typeof PATCH_COLUMNS,
        keyof PoPatchColumns,
      ][]) {
        const value = input[field];
        if (value !== undefined) changes[column] = value;
      }
      const advance = parseAmount(String(changes.advance_pct ?? po.advancePct));
      const retention = parseAmount(String(changes.retention_pct ?? po.retentionPct));
      if (advance.plus(retention).gt(100)) {
        throw new AppError('VALIDATION_ERROR', 'Advance and retention exceed 100%', [
          { field: 'retentionPct', message: 'too_large' },
        ]);
      }
      await repos.pos.patch(id, input.expectedVersion, changes);
      return this.detail(repos, id);
    });
  }

  /** POST /pos/:id/acknowledge — the supplier's signed copy (FR-036). */
  acknowledge(
    ctx: RequestContext,
    id: string,
    input: PoAcknowledgeInput
  ): Promise<Omit<PurchaseOrderDetail, 'steps'>> {
    assertPermission(ctx, PERMISSIONS_002.PO_CREATE);
    return this.deps.run(ctx, async (repos) => {
      const po = await repos.pos.get(id, { lock: true });
      assertVersion(po, input.expectedVersion);
      if (po.status !== 'approved') {
        throw new AppError('INVALID_STATE', 'Only an approved purchase order is acknowledged');
      }
      const [attachment] = await repos.tx.sql<{ id: string }[]>`
        select id from public.doc_attachment
        where tenant_id = ${ctx.tenantId} and id = ${input.attachmentId}
          and doc_type = ${po.docType} and doc_id = ${id} and deleted_at is null
          and uploaded_at is not null`;
      if (!attachment) {
        throw new AppError('VALIDATION_ERROR', 'Upload the signed copy first', [
          { field: 'attachmentId', message: 'not_found' },
        ]);
      }
      await repos.pos.acknowledge(id, input.expectedVersion, {
        acknowledgedAt: input.acknowledgedAt,
        acknowledgedByName: input.acknowledgedByName,
        attachmentId: input.attachmentId,
      });
      return this.detail(repos, id);
    });
  }

  /** POST /pos/:id/close — manual close; the remaining commitment is released (BR-21, FR-037). */
  close(
    ctx: RequestContext,
    id: string,
    input: PoCloseInput
  ): Promise<Omit<PurchaseOrderDetail, 'steps'>> {
    assertPermission(ctx, PERMISSIONS_002.PO_CLOSE);
    return this.deps.run(ctx, async (repos) => {
      const po = await repos.pos.get(id, { lock: true });
      assertVersion(po, input.expectedVersion);
      if (!PO_OPEN_STATUSES.has(po.status)) {
        throw new AppError('INVALID_STATE', 'Only an approved, open purchase order can be closed');
      }
      await repos.tx.setAuditComment(input.reason);
      await repos.budget.releaseFor(repos.tx, { docType: po.docType, docId: id }, 'po_closed');
      await repos.pos.close(id, input.reason);
      return this.detail(repos, id);
    });
  }
}
