// Payment requests against purchase orders (002 US11, FR-055–FR-060; research R25). A request
// takes its supplier, bank details, grant and lines from the PO and never reserves or commits
// budget (clarification Q3). Every amount is computed here — gross from the invoice, the advance
// recovered, the retention withheld, the deductions, the net and its words, the charge-to table —
// and nothing of it is accepted from the client (FR-058). Kinds:
//
// * order with an invoice: a three-way match per line against the accepted GRN quantities (goods)
//   or the certified amounts (services); a mismatch blocks submission (MATCH_FAILED) unless a
//   `payment:override_match` holder who is not the preparer overrides it with a reason;
// * order as an advance (`isAdvance`): up to advance_pct × PO total − advances already requested;
// * retention: releases what earlier payments withheld, once the release date has come.
//
// The payment currency is the money account's (CURRENCY_MISMATCH, FR-075); when it differs from
// the PO currency the amounts are converted at the request-date rates, which are stored. The
// approval workflow is the PAY adapter (doc-adapters/payment-request.adapter.ts), which also runs
// the no-overpayment check under the PO lock (FR-060).
import {
  Decimal,
  PERMISSIONS_002,
  advanceDeduction,
  advanceLimit,
  amountInWords,
  convert,
  deductionAmounts,
  matchGoodsLine,
  matchServiceLine,
  matchStatus,
  netAmount,
  parseAmount,
  retentionAmount,
  spreadAmount,
  type CreateOrderPaymentInput,
  type CurrencyNames,
  type ListResponse,
  type MatchOverrideInput,
  type MatchResult,
  type PaymentListQuery,
  type PaymentMethod,
  type PaymentPatchInput,
  type PaymentRequestDetail,
  type PaymentRequestSummary,
  type ResolvedRate,
} from '@ngo/shared';
import { withTenantTx, type TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import { DocSignatureRepository } from '../repositories/doc-signature.repository';
import { MoneyAccountRepository } from '../repositories/money-account.repository';
import { PaymentMatchOverrideRepository } from '../repositories/payment-match-override.repository';
import {
  PaymentRequestDeductionRepository,
  type NewPaymentDeduction,
} from '../repositories/payment-request-deduction.repository';
import {
  PaymentRequestLineRepository,
  type NewPaymentRequestLine,
} from '../repositories/payment-request-line.repository';
import type {
  PaymentAmounts,
  PaymentRequestRecord,
  PaymentRequestValues,
} from '../repositories/payment-request.repository';
import type { PurchaseOrderRecord } from '../repositories/purchase-order.repository';
import type { RequestContext } from '../types/context';
import { ensureTenantSeeds } from './doc-adapters/binding';
import { invoiceRepos, type InvoiceRepos } from './invoice.service';
import { PO_OPEN_STATUSES } from './purchase-order.service';
import { assertCanSign } from './segregation.service';

export interface PaymentRepos extends InvoiceRepos {
  requestLines: PaymentRequestLineRepository;
  deductions: PaymentRequestDeductionRepository;
  overrides: PaymentMatchOverrideRepository;
  accounts: MoneyAccountRepository;
  signatures: DocSignatureRepository;
}

export interface PaymentServiceDeps {
  run<T>(ctx: RequestContext, fn: (repos: PaymentRepos) => Promise<T>): Promise<T>;
}

export function paymentRepos(tx: TenantTx, ctx: RequestContext): PaymentRepos {
  const t = ctx.tenantId;
  return {
    ...invoiceRepos(tx, ctx),
    requestLines: new PaymentRequestLineRepository(tx.sql, t),
    deductions: new PaymentRequestDeductionRepository(tx.sql, t),
    overrides: new PaymentMatchOverrideRepository(tx.sql, t),
    accounts: new MoneyAccountRepository(tx.sql, t),
    signatures: new DocSignatureRepository(tx.sql, t, 'PAY'),
  };
}

export const defaultPaymentDeps: PaymentServiceDeps = {
  run: (ctx, fn) =>
    withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, async (tx) => {
      await ensureTenantSeeds(tx);
      return fn(paymentRepos(tx, ctx));
    }),
};

/** Statuses in which a request is recomputed, overridden or submitted. */
export const PAYMENT_EDITABLE = new Set(['draft', 'returned']);

export interface PaymentBuildInput {
  kind: 'order' | 'retention';
  invoiceId: string | null;
  isAdvance: boolean;
  grnIds?: readonly string[];
  certificateIds?: readonly string[];
  paymentMethod: PaymentMethod;
  moneyAccountId: string;
  currency: string;
  /** the request being recomputed (excluded from the PO figures) */
  exceptId: string | null;
}

export interface PaymentBuild {
  values: PaymentRequestValues;
  amounts: PaymentAmounts;
  lines: NewPaymentRequestLine[];
  deductions: NewPaymentDeduction[];
}

function assertPermission(
  ctx: RequestContext,
  permission: (typeof PERMISSIONS_002)[keyof typeof PERMISSIONS_002]
) {
  if (!ctx.permissions.has(permission)) {
    throw new AppError('FORBIDDEN', `Missing permission ${permission}`);
  }
}

function assertVersion(current: { version: number }, expected: number): void {
  if (current.version !== expected) {
    throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
  }
}

export async function currencyNames(tx: TenantTx, code: string): Promise<CurrencyNames | null> {
  const [row] = await tx.sql<CurrencyNames[]>`
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

const sum = (values: readonly string[]) =>
  values.reduce((s, v) => s.plus(parseAmount(v)), new Decimal(0)).toFixed(2);

export class PaymentRequestService {
  constructor(private readonly deps: PaymentServiceDeps = defaultPaymentDeps) {}

  // --- reads ---------------------------------------------------------------------------------

  list(ctx: RequestContext, query: PaymentListQuery): Promise<ListResponse<PaymentRequestSummary>> {
    return this.deps.run(ctx, ({ requests }) =>
      requests.list({
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        kind: query.kind,
        poId: query.poId,
        docType: 'PAY',
      })
    );
  }

  /** The request without the workflow steps (added by the route from the engine). */
  get(ctx: RequestContext, id: string): Promise<Omit<PaymentRequestDetail, 'steps'>> {
    return this.deps.run(ctx, (repos) => this.detail(repos, id));
  }

  async detail(repos: PaymentRepos, id: string): Promise<Omit<PaymentRequestDetail, 'steps'>> {
    const request = await repos.requests.get(id);
    const [lines, deductions, chargeTo, override] = await Promise.all([
      repos.requestLines.list(id),
      repos.deductions.list(id),
      repos.requestLines.chargeTo(id),
      repos.overrides.find(id),
    ]);
    return {
      ...request,
      lines,
      deductions: deductions.map(({ payableAccountId: _a, ...d }) => d),
      chargeTo,
      override,
      voucher: await this.voucherOf(repos, id),
      availableActions: this.actionsFor(repos.ctx, request),
    };
  }

  /** The live voucher generated from the request (US13); null before vouchers exist. */
  protected async voucherOf(
    repos: PaymentRepos,
    id: string
  ): Promise<PaymentRequestDetail['voucher']> {
    const [table] = await repos.tx.sql<{ exists: boolean }[]>`
      select to_regclass('public.voucher') is not null as exists`;
    if (!table?.exists) return null;
    const [row] = await repos.tx.sql<{ id: string; number: string | null; status: string }[]>`
      select id, number, status from public.voucher
      where tenant_id = ${repos.ctx.tenantId} and payment_request_id = ${id}
        and status <> 'cancelled' and reversal_of_id is null
      order by created_at desc limit 1`;
    return row ?? null;
  }

  actionsFor(ctx: RequestContext, request: PaymentRequestRecord): string[] {
    const actions: string[] = [];
    const editable = PAYMENT_EDITABLE.has(request.status);
    if (editable && ctx.permissions.has(PERMISSIONS_002.PAYMENT_CREATE)) actions.push('edit');
    if (
      editable &&
      request.matchStatus === 'mismatch' &&
      request.createdBy !== ctx.userId &&
      ctx.permissions.has(PERMISSIONS_002.PAYMENT_OVERRIDE_MATCH)
    ) {
      actions.push('override_match');
    }
    if (request.status === 'approved' && ctx.permissions.has(PERMISSIONS_002.VOUCHER_CREATE)) {
      actions.push('generate_voucher');
    }
    return actions;
  }

  // --- computation ---------------------------------------------------------------------------

  /** Lines, match, amounts and words of a request on `po` (the PO row is locked by the caller). */
  async build(
    repos: PaymentRepos,
    po: PurchaseOrderRecord,
    input: PaymentBuildInput
  ): Promise<PaymentBuild> {
    const { tx } = repos;
    const account = await repos.accounts.get(input.moneyAccountId);
    if (!account.isActive) {
      throw new AppError('VALIDATION_ERROR', 'The bank or cash account is inactive', [
        { field: 'moneyAccountId', message: 'inactive' },
      ]);
    }
    if (account.currency !== input.currency) {
      throw new AppError('CURRENCY_MISMATCH', 'The account does not pay in the request currency', {
        accountCurrency: account.currency,
        paymentCurrency: input.currency,
      });
    }

    const facts = await repos.events.tenantFacts();
    const rates = await repos.rates.resolveRates(tx, [input.currency, po.currency], facts.today);
    const payRate = rates.get(input.currency)!;
    const poRate = rates.get(po.currency)!;
    const toPay = (amountPo: string) =>
      input.currency === po.currency
        ? parseAmount(amountPo).toFixed(2)
        : convert(amountPo, poRate.rateToBase, payRate.rateToBase);

    const poLines = await repos.lines.list(po.id);
    const figures = await repos.requests.poFigures(po.id, input.exceptId);
    const [commit] = await tx.sql<{ commit: string | null; grant: string | null }[]>`
      select commit_rate_to_base::text as commit, grant_rate_to_base::text as grant
      from public.purchase_order where tenant_id = ${repos.ctx.tenantId} and id = ${po.id}`;
    const toGrant = (amountPo: string) =>
      commit?.commit && commit.grant ? convert(amountPo, commit.commit, commit.grant) : null;

    type Draft = Omit<NewPaymentRequestLine, 'gross' | 'amountGrant'> & { grossPo: string };
    let drafts: Draft[] = [];
    let advancePo = '0.00';
    let retentionPo = '0.00';
    let poAmount = '0.00';
    let grnIds: string[] = [];
    let certificateIds: string[] = [];
    const results: MatchResult[] = [];

    const spreadOverPo = (amount: string): Draft[] => {
      const parts = spreadAmount(
        amount,
        poLines.map((l) => l.lineTotal)
      );
      return poLines.map((l, i) => ({
        poLineId: l.id,
        grnLineId: null,
        certificateId: null,
        description: l.description,
        quantity: null,
        unitPrice: null,
        grossPo: parts[i]!,
        grantId: po.grantId,
        budgetLineId: l.budgetLineId,
        locationOfficeId: l.locationOfficeId,
        activityId: l.activityId,
        invoicedQty: null,
        acceptedQty: null,
        poPrice: null,
        matchResult: null,
      }));
    };

    if (input.kind === 'retention') {
      if (po.retentionReleaseDate && facts.today < po.retentionReleaseDate) {
        throw new AppError('INVALID_STATE', 'The retention is released after its release date', {
          retentionReleaseDate: po.retentionReleaseDate,
        });
      }
      const available = parseAmount(figures.retentionWithheld).minus(
        parseAmount(figures.retentionReleased)
      );
      if (available.lte(0)) throw new AppError('INVALID_STATE', 'There is no retention to release');
      drafts = spreadOverPo(available.toFixed(2));
    } else if (input.isAdvance) {
      if (parseAmount(po.advancePct).isZero()) {
        throw new AppError('ADVANCE_LIMIT_EXCEEDED', 'The order allows no advance', {
          limit: '0.00',
        });
      }
      const limit = advanceLimit({
        advancePct: po.advancePct,
        poTotal: po.totalWithAmendments,
        priorAdvances: figures.advancesRequested,
      });
      if (parseAmount(limit).lte(0)) {
        throw new AppError(
          'ADVANCE_LIMIT_EXCEEDED',
          'The advance of this order was already requested',
          {
            limit,
          }
        );
      }
      drafts = spreadOverPo(limit);
      poAmount = limit;
    } else {
      const invoice = await repos.invoices.get(input.invoiceId!, { lock: true });
      if (invoice.poId !== po.id) {
        throw new AppError('INHERITED_FIELD_MISMATCH', 'The invoice belongs to another order');
      }
      if (invoice.status !== 'registered') {
        throw new AppError('INVALID_STATE', 'The invoice is already matched or cancelled');
      }
      const used = await repos.requests.forInvoice(invoice.id);
      if (used && used.id !== input.exceptId) {
        throw new AppError('INVALID_STATE', 'The invoice already has a payment request', {
          paymentRequestId: used.id,
        });
      }
      const tolerances = await this.tolerances(repos);
      const service = po.kind === 'contract' || po.isService;
      const invoiceLines = await repos.invoices.lines(invoice.id);

      if (service) {
        const certified = await this.certified(repos, po.id, input.certificateIds, poLines);
        certificateIds = certified.ids;
        drafts = invoiceLines.map((il) => {
          const poLine = poLines.find((p) => p.id === il.poLineId)!;
          const amount = certified.perLine.get(il.poLineId) ?? '0.00';
          const result = matchServiceLine(
            { invoicedAmount: il.lineTotal, certifiedAmount: amount },
            tolerances
          );
          results.push(result);
          return {
            poLineId: il.poLineId,
            grnLineId: null,
            certificateId: certified.lastFor.get(il.poLineId) ?? null,
            description: poLine.description,
            quantity: il.quantity,
            unitPrice: il.unitPrice,
            grossPo: il.lineTotal,
            grantId: po.grantId,
            budgetLineId: poLine.budgetLineId,
            locationOfficeId: poLine.locationOfficeId,
            activityId: poLine.activityId,
            invoicedQty: il.quantity,
            acceptedQty: null,
            poPrice: poLine.unitPrice,
            matchResult: result,
          };
        });
      } else {
        const accepted = await this.accepted(repos, po.id, input.grnIds);
        grnIds = accepted.ids;
        drafts = invoiceLines.map((il) => {
          const poLine = poLines.find((p) => p.id === il.poLineId)!;
          const acc = accepted.perLine.get(il.poLineId);
          const acceptedQty = acc?.qty ?? '0.000';
          const result = matchGoodsLine(
            {
              invoicedQty: il.quantity,
              invoicedPrice: il.unitPrice,
              acceptedQty,
              poPrice: poLine.unitPrice,
            },
            tolerances
          );
          results.push(result);
          return {
            poLineId: il.poLineId,
            grnLineId: acc?.lastGrnLineId ?? null,
            certificateId: null,
            description: poLine.description,
            quantity: il.quantity,
            unitPrice: il.unitPrice,
            grossPo: il.lineTotal,
            grantId: po.grantId,
            budgetLineId: poLine.budgetLineId,
            locationOfficeId: poLine.locationOfficeId,
            activityId: poLine.activityId,
            invoicedQty: il.quantity,
            acceptedQty,
            poPrice: poLine.unitPrice,
            matchResult: result,
          };
        });
      }

      const grossPo = sum(drafts.map((d) => d.grossPo));
      const isFinal = parseAmount(figures.invoicedGross)
        .plus(parseAmount(grossPo))
        .gte(parseAmount(po.totalWithAmendments));
      advancePo = advanceDeduction({
        advancePaid: figures.advancesPaid,
        alreadyDeducted: figures.advancesDeducted,
        gross: grossPo,
        poTotal: po.totalWithAmendments,
        isFinal,
      });
      retentionPo = retentionAmount(grossPo, po.retentionPct);
      poAmount = parseAmount(grossPo).minus(parseAmount(advancePo)).toFixed(2);
    }

    const lines: NewPaymentRequestLine[] = drafts.map(({ grossPo, ...d }) => ({
      ...d,
      gross: toPay(grossPo),
      amountGrant: toGrant(grossPo),
    }));
    const gross = sum(lines.map((l) => l.gross));
    const advance = toPay(advancePo);
    const retention = toPay(retentionPo);

    let deductions: NewPaymentDeduction[] = [];
    if (input.kind === 'order' && !input.isAdvance) {
      const types = await repos.deductions.activeTypes();
      const amounts = deductionAmounts(gross, types, po.kind === 'contract' || po.isService);
      deductions = amounts.map((a) => ({
        deductionTypeId: a.id,
        base: a.base,
        ratePct: a.ratePct,
        amount: a.amount,
        payableAccountId: types.find((t) => t.id === a.id)!.payableAccountId,
      }));
    }

    let net: string;
    try {
      net = netAmount({
        gross,
        advanceDeduction: advance,
        retention,
        deductions: deductions.map((d) => d.amount),
      });
    } catch {
      throw new AppError(
        'VALIDATION_ERROR',
        'The advance, retention and deductions exceed the gross amount'
      );
    }

    const names = await currencyNames(tx, input.currency);
    const [supplier] = await tx.sql<
      {
        bank_name: string | null;
        bank_branch: string | null;
        bank_account_name: string | null;
        bank_account_no: string | null;
      }[]
    >`
      select bank_name, bank_branch, bank_account_name, bank_account_no from public.supplier
      where tenant_id = ${repos.ctx.tenantId} and id = ${po.supplierId}`;

    const rateValues = (rate: ResolvedRate) => ({
      rateToBase: rate.rateToBase,
      rateDate: rate.rateDate,
      rateSource: rate.source,
      exchangeRateId: rate.exchangeRateId,
    });

    return {
      values: {
        kind: input.kind,
        officeId: po.officeId,
        poId: po.id,
        invoiceId: input.isAdvance || input.kind === 'retention' ? null : input.invoiceId,
        isAdvance: input.isAdvance,
        grnIds,
        certificateIds,
        payeeType: 'supplier',
        supplierId: po.supplierId,
        staffPayeeId: null,
        payeeName: null,
        payeeBankName: supplier?.bank_name ?? null,
        payeeBankBranch: supplier?.bank_branch ?? null,
        payeeAccountName: supplier?.bank_account_name ?? null,
        payeeAccountNo: supplier?.bank_account_no ?? null,
        grantId: po.grantId,
        categoryId: null,
        periodText: null,
        paymentMethod: input.paymentMethod,
        moneyAccountId: input.moneyAccountId,
        currency: input.currency,
        ...rateValues(payRate),
        poRateToBase: input.currency === po.currency ? null : poRate.rateToBase,
        poExchangeRateId: input.currency === po.currency ? null : poRate.exchangeRateId,
      },
      amounts: {
        gross,
        advanceDeduction: advance,
        retentionAmount: retention,
        deductionsTotal: sum(deductions.map((d) => d.amount)),
        net,
        poAmount,
        amountInWordsAr: names ? amountInWords(net, names, 'ar') : null,
        amountInWordsEn: names ? amountInWords(net, names, 'en') : null,
        matchStatus: matchStatus(results),
      },
      lines,
      deductions,
    };
  }

  private async tolerances(repos: PaymentRepos) {
    const [row] = await repos.tx.sql<{ qty: string; price: string }[]>`
      select invoice_qty_tolerance_pct::text as qty, invoice_price_tolerance_pct::text as price
      from public.procurement_setting where tenant_id = ${repos.ctx.tenantId}`;
    return { qtyTolerancePct: row?.qty ?? '0', priceTolerancePct: row?.price ?? '0' };
  }

  /** Accepted quantity per PO line on the chosen completed GRNs (all of the PO's by default). */
  private async accepted(repos: PaymentRepos, poId: string, ids: readonly string[] | undefined) {
    const sql = repos.tx.sql;
    const rows = await sql<
      { grn_id: string; grn_line_id: string; po_line_id: string; accepted: string }[]
    >`
      select g.id as grn_id, gl.id as grn_line_id, gl.po_line_id, gl.accepted_qty::text as accepted
      from public.grn g join public.grn_line gl on gl.grn_id = g.id
      where g.tenant_id = ${repos.ctx.tenantId} and g.po_id = ${poId} and g.status = 'completed'
        ${ids ? sql`and g.id = any (${sql.array([...ids])}::uuid[])` : sql``}
      order by g.completed_at, g.id`;
    const found = [...new Set(rows.map((r) => r.grn_id))];
    if (ids && ids.some((id) => !found.includes(id))) {
      throw new AppError(
        'VALIDATION_ERROR',
        'A chosen GRN is not a completed receipt of this order',
        [{ field: 'grnIds', message: 'not_found' }]
      );
    }
    const perLine = new Map<string, { qty: string; lastGrnLineId: string }>();
    for (const r of rows) {
      const prev = perLine.get(r.po_line_id);
      perLine.set(r.po_line_id, {
        qty: parseAmount(prev?.qty ?? '0')
          .plus(parseAmount(r.accepted))
          .toFixed(3),
        lastGrnLineId: r.grn_line_id,
      });
    }
    return { ids: found, perLine };
  }

  /**
   * Certified amount per PO line on the chosen completed certificates: the latest (cumulative)
   * certificate per target; milestone certificates are spread over the lines by line total.
   */
  private async certified(
    repos: PaymentRepos,
    poId: string,
    ids: readonly string[] | undefined,
    poLines: readonly { id: string; lineTotal: string }[]
  ) {
    const sql = repos.tx.sql;
    const rows = await sql<
      { id: string; po_line_id: string | null; milestone_id: string | null; amount: string }[]
    >`
      select c.id, c.po_line_id, c.milestone_id, c.certified_amount::text as amount
      from public.completion_certificate c
      where c.tenant_id = ${repos.ctx.tenantId} and c.po_id = ${poId} and c.status = 'completed'
        ${ids ? sql`and c.id = any (${sql.array([...ids])}::uuid[])` : sql``}
      order by c.completed_at, c.id`;
    if (ids && ids.some((id) => !rows.some((r) => r.id === id))) {
      throw new AppError(
        'VALIDATION_ERROR',
        'A chosen certificate is not a completed certificate of this order',
        [{ field: 'certificateIds', message: 'not_found' }]
      );
    }
    const latest = new Map<string, { id: string; poLineId: string | null; amount: string }>();
    for (const r of rows) {
      latest.set(r.po_line_id ?? `m:${r.milestone_id}`, {
        id: r.id,
        poLineId: r.po_line_id,
        amount: r.amount,
      });
    }
    const perLine = new Map<string, string>();
    const lastFor = new Map<string, string>();
    const add = (lineId: string, amount: string) =>
      perLine.set(
        lineId,
        parseAmount(perLine.get(lineId) ?? '0')
          .plus(parseAmount(amount))
          .toFixed(2)
      );
    let milestones = new Decimal(0);
    for (const c of latest.values()) {
      if (c.poLineId) {
        add(c.poLineId, c.amount);
        lastFor.set(c.poLineId, c.id);
      } else {
        milestones = milestones.plus(parseAmount(c.amount));
      }
    }
    if (milestones.gt(0)) {
      const parts = spreadAmount(
        milestones.toFixed(2),
        poLines.map((l) => l.lineTotal)
      );
      poLines.forEach((l, i) => add(l.id, parts[i]!));
    }
    return { ids: rows.map((r) => r.id), perLine, lastFor };
  }

  private async write(repos: PaymentRepos, id: string, build: PaymentBuild): Promise<void> {
    await repos.requestLines.replace(id, build.lines);
    await repos.deductions.replace(id, build.deductions);
  }

  // --- commands ------------------------------------------------------------------------------

  /** POST /pos/:id/payment-requests — a computed draft, including the match. */
  create(
    ctx: RequestContext,
    poId: string,
    input: CreateOrderPaymentInput
  ): Promise<Omit<PaymentRequestDetail, 'steps'>> {
    assertPermission(ctx, PERMISSIONS_002.PAYMENT_CREATE);
    return this.deps.run(ctx, async (repos) => {
      const po = await repos.pos.get(poId, { lock: true });
      if (
        !PO_OPEN_STATUSES.has(po.status) &&
        !(input.kind === 'retention' && po.status === 'closed')
      ) {
        throw new AppError(
          'INVALID_STATE',
          'Payments are requested against an approved, open order'
        );
      }
      const build = await this.build(repos, po, {
        kind: input.kind ?? 'order',
        invoiceId: input.invoiceId ?? null,
        isAdvance: input.isAdvance ?? false,
        grnIds: input.grnIds,
        certificateIds: input.certificateIds,
        paymentMethod: input.paymentMethod,
        moneyAccountId: input.moneyAccountId,
        currency: input.currency,
        exceptId: null,
      });
      const id = await repos.requests.insert(build.values, build.amounts);
      await this.write(repos, id, build);
      return this.detail(repos, id);
    });
  }

  /** PATCH /payment-requests/:id — method or account; the request is recomputed. */
  patch(
    ctx: RequestContext,
    id: string,
    input: PaymentPatchInput
  ): Promise<Omit<PaymentRequestDetail, 'steps'>> {
    assertPermission(ctx, PERMISSIONS_002.PAYMENT_CREATE);
    return this.deps.run(ctx, async (repos) => {
      const request = await repos.requests.get(id, { lock: true });
      assertVersion(request, input.expectedVersion);
      if (!PAYMENT_EDITABLE.has(request.status)) {
        throw new AppError(
          'INVALID_STATE',
          'Only a draft or returned payment request can be edited'
        );
      }
      if (!request.poId || (request.kind !== 'order' && request.kind !== 'retention')) {
        throw new AppError(
          'INVALID_STATE',
          'Only payment requests against an order are edited here'
        );
      }
      const po = await repos.pos.get(request.poId, { lock: true });
      const account = input.moneyAccountId ?? request.moneyAccountId;
      const currency = input.moneyAccountId
        ? (await repos.accounts.get(input.moneyAccountId)).currency
        : request.currency;
      if (currency !== request.currency) {
        throw new AppError(
          'CURRENCY_MISMATCH',
          'The account does not pay in the request currency',
          {
            accountCurrency: currency,
            paymentCurrency: request.currency,
          }
        );
      }
      const build = await this.build(repos, po, {
        kind: request.kind,
        invoiceId: request.invoiceId,
        isAdvance: request.isAdvance,
        grnIds:
          request.kind === 'order' && !request.isAdvance && request.grnIds.length
            ? request.grnIds
            : undefined,
        certificateIds:
          request.kind === 'order' && !request.isAdvance && request.certificateIds.length
            ? request.certificateIds
            : undefined,
        paymentMethod: input.paymentMethod ?? request.paymentMethod,
        moneyAccountId: account,
        currency,
        exceptId: id,
      });
      // an override stands only while the recomputed match still fails
      const override = await repos.overrides.find(id);
      const amounts =
        override && build.amounts.matchStatus === 'mismatch'
          ? { ...build.amounts, matchStatus: 'overridden' as const }
          : build.amounts;
      if (override && amounts.matchStatus !== 'overridden') await repos.overrides.remove(id);
      await repos.requests.rewrite(id, input.expectedVersion, build.values, amounts);
      await this.write(repos, id, build);
      return this.detail(repos, id);
    });
  }

  /** POST /payment-requests/:id/match-override — a reason, by a holder who did not prepare it. */
  overrideMatch(
    ctx: RequestContext,
    id: string,
    input: MatchOverrideInput
  ): Promise<Omit<PaymentRequestDetail, 'steps'>> {
    assertPermission(ctx, PERMISSIONS_002.PAYMENT_OVERRIDE_MATCH);
    return this.deps.run(ctx, async (repos) => {
      const request = await repos.requests.get(id, { lock: true });
      assertVersion(request, input.expectedVersion);
      if (!PAYMENT_EDITABLE.has(request.status)) {
        throw new AppError('INVALID_STATE', 'The match is overridden before submission');
      }
      if (request.matchStatus !== 'mismatch') {
        throw new AppError('INVALID_STATE', 'Only a failed match is overridden');
      }
      const prior = await repos.signatures.list(id);
      assertCanSign(
        { docType: 'PAY', creatorId: request.createdBy },
        ctx.userId,
        { kind: 'override_match' },
        prior.map((s) => ({
          userId: s.userId,
          action: s.action,
          cycle: s.cycle,
          stepOrder: s.stepOrder,
        }))
      );
      const [me] = await repos.tx.sql<
        { full_name_ar: string; full_name_en: string; position_title: string | null }[]
      >`
        select full_name_ar, full_name_en, position_title from public.membership
        where tenant_id = ${ctx.tenantId} and user_id = ${ctx.userId}`;
      if (!me) throw new AppError('FORBIDDEN', 'No membership in this organization');

      await repos.tx.setAuditComment(input.reason);
      await repos.overrides.insert(id, input.reason);
      await repos.signatures.insert({
        docId: id,
        stepId: null,
        cycle: Math.max(request.submissionCycle, 1),
        stepOrder: null,
        action: 'override_match',
        userName: me.full_name_en,
        userPosition: me.position_title,
        comment: input.reason,
        payload: { nameAr: me.full_name_ar },
      });
      await repos.requests.setMatchStatus(id, input.expectedVersion, 'overridden');
      return this.detail(repos, id);
    });
  }
}
