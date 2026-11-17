// Payment vouchers and posting (002 US13, FR-066–FR-075; research D5, D2; contracts/
// posting-rules.md). An approved payment request gives a balanced BPV (bank) or CPV (cash)
// draft from the pure generator; it is submitted (number), checked and approved by three
// different people through the PV route (doc-adapters/voucher.adapter.ts), then posted here:
//
// * the voucher month's period must be open, read FOR SHARE (PERIOD_CLOSED);
// * cash, and cheques, need the received-by name, date and signed copy (RECEIVED_BY_REQUIRED);
// * every line gets the grant rate of the voucher date and its period; expense lines with a
//   budget line record Actual = (debit − credit) × r(T) ÷ r(G);
// * the order's (or direct request's) commitment is consumed at its own locked rate
//   (`consumed_by_payment`), the request becomes paid, the PO lines' paid amounts grow, and a
//   PO fully received and fully paid closes;
// * the print snapshot is frozen.
//
// A posted voucher never changes; it is reversed by a mirrored draft at the original rates,
// which goes through the same flow and, when posted, restores the consumed commitment and stamps
// the original (US13-6).
import {
  Decimal,
  PERMISSIONS_002,
  actualGrantAmount,
  amountInWords,
  baseTotals,
  generatePaymentVoucher,
  mirrorLines,
  parseAmount,
  type GenerateVoucherInput,
  type ListResponse,
  type Permission,
  type VoucherDetail,
  type VoucherListQuery,
  type VoucherPostInput,
  type VoucherReverseInput,
  type VoucherSummary,
} from '@ngo/shared';
import { withTenantTx, type TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import { AccountingPeriodRepository } from '../repositories/accounting-period.repository';
import { BudgetCategoryAccountRepository } from '../repositories/budget-category-account.repository';
import { ControlAccountRepository } from '../repositories/control-account.repository';
import { DocSignatureRepository } from '../repositories/doc-signature.repository';
import {
  VoucherLineRepository,
  type VoucherLineRecord,
} from '../repositories/voucher-line.repository';
import { VoucherRepository, type VoucherRecord } from '../repositories/voucher.repository';
import type { RequestContext } from '../types/context';
import { ensureTenantSeeds } from './doc-adapters/binding';
import { assertPeriodOpen } from './period.service';
import { currencyNames, paymentRepos, type PaymentRepos } from './payment-request.service';

export interface VoucherRepos extends PaymentRepos {
  vouchers: VoucherRepository;
  voucherLines: VoucherLineRepository;
  periods: AccountingPeriodRepository;
  expenseAccounts: BudgetCategoryAccountRepository;
  controls: ControlAccountRepository;
}

export interface VoucherServiceDeps {
  run<T>(ctx: RequestContext, fn: (repos: VoucherRepos) => Promise<T>): Promise<T>;
}

export function voucherRepos(tx: TenantTx, ctx: RequestContext): VoucherRepos {
  const t = ctx.tenantId;
  return {
    ...paymentRepos(tx, ctx),
    vouchers: new VoucherRepository(tx.sql, t),
    voucherLines: new VoucherLineRepository(tx.sql, t),
    periods: new AccountingPeriodRepository(tx.sql, t),
    expenseAccounts: new BudgetCategoryAccountRepository(tx.sql, t),
    controls: new ControlAccountRepository(tx.sql, t),
  };
}

export const defaultVoucherDeps: VoucherServiceDeps = {
  run: (ctx, fn) =>
    withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, async (tx) => {
      await ensureTenantSeeds(tx);
      return fn(voucherRepos(tx, ctx));
    }),
};

export const VOUCHER_EDITABLE = new Set(['draft', 'returned']);

function assertPermission(ctx: RequestContext, permission: Permission): void {
  if (!ctx.permissions.has(permission)) {
    throw new AppError('FORBIDDEN', `Missing permission ${permission}`);
  }
}

/** CPV, or a BPV paid by cheque, needs received-by before posting (FR-074). */
export function requiresReceivedBy(
  v: Pick<VoucherRecord, 'type' | 'paymentMethod' | 'reversalOfId'>
): boolean {
  if (v.reversalOfId) return false;
  return v.type === 'CPV' || (v.type === 'BPV' && v.paymentMethod === 'cheque');
}

const firstOfMonth = (date: string) => `${date.slice(0, 7)}-01`;
const chargeKey = (l: {
  budgetLineId: string | null;
  locationOfficeId: string | null;
  activityId: string | null;
}) => `${l.budgetLineId ?? ''}|${l.locationOfficeId ?? ''}|${l.activityId ?? ''}`;

export class VoucherService {
  constructor(private readonly deps: VoucherServiceDeps = defaultVoucherDeps) {}

  // --- reads ---------------------------------------------------------------------------------

  list(ctx: RequestContext, query: VoucherListQuery): Promise<ListResponse<VoucherSummary>> {
    return this.deps.run(ctx, ({ vouchers }) =>
      vouchers.list({
        page: query.page,
        pageSize: query.pageSize,
        type: query.type,
        status: query.status,
        paymentRequestId: query.paymentRequestId,
      })
    );
  }

  typeOf(ctx: RequestContext, id: string) {
    return this.deps.run(ctx, ({ vouchers }) => vouchers.typeOf(id));
  }

  get(ctx: RequestContext, id: string): Promise<Omit<VoucherDetail, 'steps'>> {
    return this.deps.run(ctx, (repos) => this.detail(repos, id));
  }

  async detail(repos: VoucherRepos, id: string): Promise<Omit<VoucherDetail, 'steps'>> {
    const voucher = await repos.vouchers.get(id);
    const lines = await repos.voucherLines.list(id);
    const facts = await repos.events.tenantFacts();
    return {
      ...voucher,
      totals: { ...baseTotals(lines), baseCurrency: facts.baseCurrency },
      requiresReceivedBy: requiresReceivedBy(voucher),
      lines: lines.map(
        ({
          accountType: _t,
          rateSource: _s,
          exchangeRateId: _e,
          grantCurrency: _g,
          paymentRequestLineId: _p,
          poLineId: _o,
          consumedCommitmentId: _c,
          grantRateToBase: _r,
          ...l
        }) => l
      ),
      availableActions: this.actionsFor(repos.ctx, voucher),
    };
  }

  actionsFor(ctx: RequestContext, v: VoucherRecord): string[] {
    const actions: string[] = [];
    if (v.status === 'approved' && ctx.permissions.has(PERMISSIONS_002.VOUCHER_POST)) {
      actions.push('post');
    }
    if (
      v.status === 'posted' &&
      !v.reversedById &&
      !v.reversalOfId &&
      ctx.permissions.has(PERMISSIONS_002.VOUCHER_REVERSE)
    ) {
      actions.push('reverse');
    }
    return actions;
  }

  // --- generation ----------------------------------------------------------------------------

  /** POST /payment-requests/:id/voucher — a balanced BPV / CPV draft from the generator. */
  generateFromPaymentRequest(
    ctx: RequestContext,
    requestId: string,
    input: GenerateVoucherInput
  ): Promise<Omit<VoucherDetail, 'steps'>> {
    assertPermission(ctx, PERMISSIONS_002.VOUCHER_CREATE);
    return this.deps.run(ctx, async (repos) => {
      const request = await repos.requests.get(requestId, { lock: true });
      if (request.status !== 'approved') {
        throw new AppError(
          'INVALID_STATE',
          'A voucher is generated from an approved payment request'
        );
      }
      if (await repos.vouchers.liveForPaymentRequest(requestId)) {
        throw new AppError('INVALID_STATE', 'The payment request already has a voucher');
      }
      const facts = await repos.events.tenantFacts();
      const voucherDate = input.voucherDate ?? facts.today;
      const account = await repos.accounts.get(request.moneyAccountId);
      const rates = await repos.rates.resolveRates(
        repos.tx,
        [request.currency, request.grantCurrency],
        voucherDate
      );
      const rate = rates.get(request.currency)!;
      const grantRate = rates.get(request.grantCurrency)!;

      const lines = await repos.requestLines.list(requestId);
      const resolved = await repos.expenseAccounts.resolve(lines.map((l) => l.budgetLineId));
      const deductions = await repos.deductions.list(requestId);
      const [grant] = await repos.tx.sql<{ donor_id: string }[]>`
        select donor_id from public."grant" where id = ${request.grantId}`;
      const control = {
        supplierAdvances: await repos.controls.accountFor('supplier_advances'),
        retentionPayable: await repos.controls.accountFor('retention_payable'),
        staffAdvances: await repos.controls.accountFor('staff_advances'),
        exchangeGainLoss: await repos.controls.accountFor('exchange_gain_loss'),
      };

      const result = generatePaymentVoucher({
        kind:
          request.kind === 'retention'
            ? 'retention'
            : request.isAdvance
              ? 'advance'
              : request.kind === 'direct'
                ? 'direct'
                : 'order',
        baseCurrency: facts.baseCurrency,
        currency: request.currency,
        gross: request.gross,
        advanceDeduction: request.advanceDeduction,
        retentionAmount: request.retentionAmount,
        net: request.net,
        lines: lines.map((l) => ({
          id: l.id,
          description: l.description,
          gross: l.gross,
          grantId: request.grantId,
          budgetLineId: l.budgetLineId,
          locationOfficeId: l.locationOfficeId,
          activityId: l.activityId,
          poLineId: l.poLineId,
        })),
        deductions: deductions.map((d) => ({
          payableAccountId: d.payableAccountId,
          amount: d.amount,
          description: d.nameEn,
        })),
        rate: {
          rateToBase: rate.rateToBase,
          rateDate: rate.rateDate,
          rateSource: rate.source,
          exchangeRateId: rate.exchangeRateId,
        },
        grantRate: {
          rateToBase: grantRate.rateToBase,
          rateDate: grantRate.rateDate,
          rateSource: grantRate.source,
          exchangeRateId: grantRate.exchangeRateId,
        },
        moneyAccount: {
          glAccountId: account.glAccountId,
          kind: account.kind,
          currency: account.currency,
          name: account.name,
        },
        expenseAccounts: Object.fromEntries(resolved.map((r) => [r.budgetLineId, r.accountId])),
        budgetLineCodes: Object.fromEntries(resolved.map((r) => [r.budgetLineId, r.code])),
        control,
        donorId: grant?.donor_id ?? null,
        categoryText: null,
        payeeName: request.payeeNameEn,
      });
      if (!result.ok) {
        const e = result.error;
        switch (e.code) {
          case 'CURRENCY_MISMATCH':
            throw new AppError(
              'CURRENCY_MISMATCH',
              'The account does not pay in the request currency',
              {
                accountCurrency: e.accountCurrency,
                paymentCurrency: e.paymentCurrency,
              }
            );
          case 'BUDGET_LINE_UNMAPPED':
            throw new AppError('BUDGET_LINE_UNMAPPED', 'Budget lines without an expense account', {
              budgetLineIds: e.budgetLineIds,
              codes: e.codes,
            });
          case 'CONTROL_ACCOUNT_MISSING':
            throw new AppError('VALIDATION_ERROR', `The control account ${e.key} is not set`, [
              { field: e.key, message: 'control_account_missing' },
            ]);
          case 'UNBALANCED':
            throw new AppError('VOUCHER_UNBALANCED', 'The generated voucher does not balance', {
              baseDebit: e.baseDebit,
              baseCredit: e.baseCredit,
              difference: e.difference,
            });
        }
      }
      const draft = result.value;
      if (request.paymentMethod === 'cheque' && draft.type === 'BPV' && !input.chequeNo) {
        throw new AppError('VALIDATION_ERROR', 'A cheque payment needs the cheque number', [
          { field: 'chequeNo', message: 'required' },
        ]);
      }

      const names = await currencyNames(repos.tx, draft.currency);
      const id = await repos.vouchers.insert({
        type: draft.type,
        officeId: request.officeId,
        voucherDate,
        moneyAccountId: request.moneyAccountId,
        paymentMethod: request.paymentMethod,
        chequeNo: input.chequeNo ?? null,
        payeeName: request.payeeNameEn,
        currency: draft.currency,
        amount: draft.amount,
        amountInWordsAr: names ? amountInWords(draft.amount, names, 'ar') : null,
        amountInWordsEn: names ? amountInWords(draft.amount, names, 'en') : null,
        reason: null,
        paymentRequestId: requestId,
        grantId: request.grantId,
        reversalOfId: null,
      });
      await repos.voucherLines.insertMany(
        id,
        draft.lines.map(({ isMoneySide: _m, ...l }) => l)
      );
      return this.detail(repos, id);
    });
  }

  // --- posting -------------------------------------------------------------------------------

  /** POST /vouchers/:id/post */
  post(
    ctx: RequestContext,
    id: string,
    input: VoucherPostInput
  ): Promise<Omit<VoucherDetail, 'steps'>> {
    assertPermission(ctx, PERMISSIONS_002.VOUCHER_POST);
    return this.deps.run(ctx, async (repos) => {
      const voucher = await repos.vouchers.get(id, { lock: true });
      if (voucher.version !== input.expectedVersion) {
        throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
      }
      if (voucher.status !== 'approved') {
        throw new AppError('INVALID_STATE', 'Only an approved voucher is posted');
      }
      await assertPeriodOpen(repos.periods, voucher.voucherDate);

      const receivedByName = input.receivedByName ?? voucher.receivedByName;
      const receivedOn = input.receivedOn ?? voucher.receivedOn;
      const copy = input.receivedCopyAttachmentId ?? voucher.receivedCopyAttachmentId;
      if (requiresReceivedBy(voucher)) {
        if (!receivedByName || !receivedOn || !copy) {
          throw new AppError(
            'RECEIVED_BY_REQUIRED',
            'Enter who received the payment, when, and upload the signed copy'
          );
        }
        const [attachment] = await repos.tx.sql<{ id: string }[]>`
          select id from public.doc_attachment
          where tenant_id = ${ctx.tenantId} and id = ${copy} and doc_type = ${voucher.type}
            and doc_id = ${id} and deleted_at is null and uploaded_at is not null`;
        if (!attachment) {
          throw new AppError('RECEIVED_BY_REQUIRED', 'Upload the signed copy to the voucher first');
        }
      }
      if (voucher.type === 'BPV' && voucher.paymentMethod === 'cheque' && !voucher.chequeNo) {
        throw new AppError('VALIDATION_ERROR', 'A cheque payment needs the cheque number', [
          { field: 'chequeNo', message: 'required' },
        ]);
      }

      const lines = await repos.voucherLines.list(id);
      const period = firstOfMonth(voucher.voucherDate);
      if (voucher.reversalOfId) {
        await this.postReversal(repos, voucher, lines, period);
      } else {
        await this.postOriginal(repos, voucher, lines, period);
      }

      const detail = await this.detail(repos, id);
      await repos.vouchers.markPosted(id, input.expectedVersion, {
        userId: ctx.userId,
        receivedByName: input.receivedByName ?? null,
        receivedOn: input.receivedOn ?? null,
        receivedCopyAttachmentId: input.receivedCopyAttachmentId ?? null,
        printSnapshot: {
          ...detail,
          receivedByName,
          receivedOn,
          postedBy: ctx.userId,
        } as unknown as Record<string, unknown>,
      });
      const signatures = new DocSignatureRepository(repos.tx.sql, ctx.tenantId, voucher.type);
      const [me] = await repos.tx.sql<
        { full_name_ar: string; full_name_en: string; position_title: string | null }[]
      >`
        select full_name_ar, full_name_en, position_title from public.membership
        where tenant_id = ${ctx.tenantId} and user_id = ${ctx.userId}`;
      await signatures.insert({
        docId: id,
        stepId: null,
        cycle: Math.max(voucher.submissionCycle, 1),
        stepOrder: null,
        action: 'post',
        userName: me?.full_name_en ?? '',
        userPosition: me?.position_title ?? null,
        comment: null,
        payload: { nameAr: me?.full_name_ar ?? '' },
      });
      return this.detail(repos, id);
    });
  }

  /** Actual at the grant rate of the voucher date, the commitment consumed, the request paid. */
  private async postOriginal(
    repos: VoucherRepos,
    voucher: VoucherRecord,
    lines: VoucherLineRecord[],
    period: string
  ): Promise<void> {
    const { tx } = repos;
    const grantCurrencies = [
      ...new Set(lines.map((l) => l.grantCurrency).filter((c): c is string => !!c)),
    ];
    const grantRates = grantCurrencies.length
      ? await repos.rates.resolveRates(tx, grantCurrencies, voucher.voucherDate)
      : new Map();

    // the commitment each charge-to row consumes: Σ amount_grant of its request lines (D2)
    const request = voucher.paymentRequestId
      ? await repos.requests.get(voucher.paymentRequestId, { lock: true })
      : null;
    const consumes = new Map<string, Decimal>();
    let source: { docType: 'PO' | 'CON' | 'DPR'; docId: string } | null = null;
    if (request && !request.isAdvance && (request.kind === 'order' || request.kind === 'direct')) {
      if (request.kind === 'order' && request.poId) {
        const po = await repos.pos.get(request.poId, { lock: true });
        source = { docType: po.docType, docId: po.id };
      } else if (request.kind === 'direct') {
        source = { docType: 'DPR', docId: request.id };
      }
      for (const l of await repos.requestLines.list(request.id)) {
        if (!l.amountGrant) continue;
        const key = chargeKey(l);
        consumes.set(key, (consumes.get(key) ?? new Decimal(0)).plus(parseAmount(l.amountGrant)));
      }
    }
    const open = source
      ? (await repos.sources.list(tx, source)).filter((c) => c.status !== 'released')
      : [];
    if (open.length) {
      await tx.sql`
        select id from public.budget_line
        where id = any (${tx.sql.array([...new Set(open.map((c) => c.budgetLineId))])}::uuid[])
        order by id for update`;
    }

    for (const l of lines) {
      const grantRate = l.grantCurrency ? grantRates.get(l.grantCurrency) : undefined;
      const expense = l.accountType === 'expense' && l.budgetLineId !== null;
      let consumed: Decimal | null = null;
      let consumedRowId: string | null = null;
      if (expense && source && parseAmount(l.debit).gt(0)) {
        let left = consumes.get(chargeKey(l)) ?? new Decimal(0);
        consumes.delete(chargeKey(l));
        for (const row of open.filter(
          (c) => c.budgetLineId === l.budgetLineId && c.status !== 'released'
        )) {
          if (left.lte(0)) break;
          const take = Decimal.min(left, parseAmount(row.amount));
          if (take.lte(0)) continue;
          const { released, remainder } = await repos.budget.splitConsume(
            tx,
            row.id,
            take.toFixed(2),
            'consumed_by_payment'
          );
          // the remainder replaces the row in the open list
          row.status = 'released';
          if (remainder) open.push(remainder);
          consumed = (consumed ?? new Decimal(0)).plus(take);
          consumedRowId = released.id;
          left = left.minus(take);
        }
      }
      await repos.voucherLines.stampPosting(l.id, {
        grantRateToBase: grantRate?.rateToBase ?? null,
        grantRateDate: grantRate?.rateDate ?? null,
        grantRateSource: grantRate?.source ?? null,
        grantExchangeRateId: grantRate?.exchangeRateId ?? null,
        actualGrantAmount:
          expense && grantRate
            ? actualGrantAmount({
                debit: l.debit,
                credit: l.credit,
                rateToBase: l.rateToBase,
                grantRateToBase: grantRate.rateToBase,
              })
            : null,
        commitmentConsumedGrant: consumed ? consumed.toFixed(2) : null,
        consumedCommitmentId: consumedRowId,
        postedPeriod: period,
      });
    }

    if (request) {
      await tx.sql`
        update public.payment_request
        set status = 'paid', paid_at = now(), paid_on = ${voucher.voucherDate}
        where tenant_id = ${repos.ctx.tenantId} and id = ${request.id}`;
      if (request.poId) await this.refreshPoPaid(repos, request.poId, request.id, 1);
    }
  }

  /** The mirrored lines keep their rates and Actual; consumed commitments are restored. */
  private async postReversal(
    repos: VoucherRepos,
    voucher: VoucherRecord,
    lines: VoucherLineRecord[],
    period: string
  ): Promise<void> {
    const { tx } = repos;
    const original = await repos.vouchers.get(voucher.reversalOfId!, { lock: true });
    if (original.status !== 'posted' || original.reversedById) {
      throw new AppError('INVALID_STATE', 'The original voucher is not posted or already reversed');
    }
    const originalLines = await repos.voucherLines.list(original.id);
    for (const l of originalLines) {
      if (l.consumedCommitmentId && l.commitmentConsumedGrant) {
        await repos.budget.restore(tx, l.consumedCommitmentId, l.commitmentConsumedGrant);
      }
    }
    // mirrored line n carries the grant rate original line n was posted at
    for (const [i, l] of lines.entries()) {
      await repos.voucherLines.stampPosting(l.id, {
        grantRateToBase: originalLines[i]?.grantRateToBase ?? null,
        grantRateDate: null,
        grantRateSource: null,
        grantExchangeRateId: null,
        actualGrantAmount: l.actualGrantAmount,
        commitmentConsumedGrant: null,
        consumedCommitmentId: null,
        postedPeriod: period,
      });
    }
    await repos.vouchers.stampReversed(original.id, voucher.id);
    if (original.paymentRequestId) {
      const request = await repos.requests.get(original.paymentRequestId, { lock: true });
      await tx.sql`
        update public.payment_request set status = 'approved', paid_at = null, paid_on = null
        where tenant_id = ${repos.ctx.tenantId} and id = ${request.id} and status = 'paid'`;
      if (request.poId) await this.refreshPoPaid(repos, request.poId, request.id, -1);
    }
  }

  /**
   * po_line.paid_amount moves by the request's line gross in the PO currency; a PO fully
   * received and fully paid closes and releases what it still holds (FR-037).
   */
  private async refreshPoPaid(repos: VoucherRepos, poId: string, requestId: string, sign: 1 | -1) {
    const { tx, ctx } = repos;
    await tx.sql`
      update public.po_line o
      set paid_amount = greatest(o.paid_amount + ${sign} * x.amount, 0)
      from (
        select l.po_line_id,
               sum(round(l.gross * r.rate_to_base / coalesce(r.po_rate_to_base, r.rate_to_base), 2))
                 as amount
        from public.payment_request_line l
        join public.payment_request r on r.id = l.payment_request_id
        where l.payment_request_id = ${requestId} and l.po_line_id is not null
          and r.kind = 'order' and not r.is_advance
        group by l.po_line_id
      ) x
      where o.tenant_id = ${ctx.tenantId} and o.id = x.po_line_id`;
    if (sign < 0) return;
    const [state] = await tx.sql<{ status: string; unpaid: boolean; doc_type: 'PO' | 'CON' }[]>`
      select p.status, p.doc_type,
             exists (select 1 from public.po_line o where o.po_id = p.id and o.paid_amount < o.line_total)
               as unpaid
      from public.purchase_order p where p.tenant_id = ${ctx.tenantId} and p.id = ${poId}`;
    if (state && state.status === 'fully_received' && !state.unpaid) {
      await tx.setAuditComment('Fully received and fully paid');
      await repos.budget.releaseFor(tx, { docType: state.doc_type, docId: poId }, 'po_closed');
      await repos.pos.close(poId, 'Fully received and fully paid');
    }
  }

  // --- reversal ------------------------------------------------------------------------------

  /** POST /vouchers/:id/reverse — a mirrored draft dated `reversalDate`, at the original rates. */
  reverse(
    ctx: RequestContext,
    id: string,
    input: VoucherReverseInput
  ): Promise<Omit<VoucherDetail, 'steps'>> {
    assertPermission(ctx, PERMISSIONS_002.VOUCHER_REVERSE);
    return this.deps.run(ctx, async (repos) => {
      const voucher = await repos.vouchers.get(id, { lock: true });
      if (voucher.version !== input.expectedVersion) {
        throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
      }
      if (voucher.status !== 'posted' || voucher.reversedById || voucher.reversalOfId) {
        throw new AppError(
          'INVALID_STATE',
          'Only a posted voucher that is not reversed can be reversed'
        );
      }
      if (await repos.vouchers.liveReversalOf(id)) {
        throw new AppError('INVALID_STATE', 'The voucher already has a reversal in progress');
      }
      if (input.reversalDate < voucher.voucherDate) {
        throw new AppError('VALIDATION_ERROR', 'The reversal cannot be dated before the voucher', [
          { field: 'reversalDate', message: 'before_voucher_date' },
        ]);
      }
      await repos.tx.setAuditComment(input.reason);
      const lines = await repos.voucherLines.list(id);
      const reversalId = await repos.vouchers.insert({
        type: voucher.type,
        officeId: voucher.officeId,
        voucherDate: input.reversalDate,
        moneyAccountId: voucher.moneyAccountId,
        paymentMethod: voucher.paymentMethod,
        chequeNo: voucher.chequeNo,
        payeeName: voucher.payeeName,
        currency: voucher.currency,
        amount: voucher.amount,
        amountInWordsAr: voucher.amountInWordsAr,
        amountInWordsEn: voucher.amountInWordsEn,
        reason: input.reason,
        paymentRequestId: voucher.paymentRequestId,
        grantId: voucher.grantId,
        reversalOfId: id,
      });
      await repos.voucherLines.insertMany(
        reversalId,
        mirrorLines(lines).map((l) => ({
          accountId: l.accountId,
          description: l.description,
          currency: l.currency,
          debit: l.debit,
          credit: l.credit,
          rateToBase: l.rateToBase,
          rateDate: l.rateDate,
          rateSource: l.rateSource,
          exchangeRateId: l.exchangeRateId,
          baseDebit: l.baseDebit,
          baseCredit: l.baseCredit,
          grantId: l.grantId,
          budgetLineId: l.budgetLineId,
          locationOfficeId: l.locationOfficeId,
          activityId: l.activityId,
          donorId: l.donorId,
          categoryText: l.categoryText,
          actualGrantAmount: l.actualGrantAmount,
          paymentRequestLineId: l.paymentRequestLineId,
          poLineId: l.poLineId,
        }))
      );
      return this.detail(repos, reversalId);
    });
  }
}
