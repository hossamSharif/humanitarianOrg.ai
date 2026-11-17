// payment_request (002 data-model §7, research R25): one table for PAY (order, retention) and
// DPR (direct). Supplier, grant and office of an order request are re-copied from the PO by
// trigger (app.payment_request_inherit) and never changed; the amounts are computed by
// payment-request.service and written here as a whole (no API input reaches them).
import type {
  ListResponse,
  MatchStatus,
  PaymentMethod,
  PaymentRequestKind,
  PaymentRequestStatus,
  PaymentRequestSummary,
  PayeeType,
} from '@ngo/shared';
import type postgres from 'postgres';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

export interface PaymentRequestRecord extends PaymentRequestSummary {
  version: number;
  officeId: string;
  createdBy: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  supplierInvoiceNo: string | null;
  payeeType: PayeeType;
  supplierId: string | null;
  staffPayeeId: string | null;
  payeeBankName: string | null;
  payeeBankBranch: string | null;
  payeeAccountName: string | null;
  payeeAccountNo: string | null;
  grantId: string;
  grantCode: string;
  grantCurrency: string;
  grantStatus: string;
  supplierStatus: string | null;
  paymentMethod: PaymentMethod;
  moneyAccountId: string;
  moneyAccountName: string;
  moneyAccountKind: 'bank' | 'cash';
  rateToBase: string;
  rateDate: string | null;
  rateSource: string | null;
  exchangeRateId: string | null;
  poCurrency: string | null;
  poRateToBase: string | null;
  gross: string;
  advanceDeduction: string;
  retentionAmount: string;
  deductionsTotal: string;
  poAmount: string;
  amountInWordsAr: string | null;
  amountInWordsEn: string | null;
  grnIds: string[];
  certificateIds: string[];
  paidOn: string | null;
  submissionCycle: number;
  currentStepOrder: number | null;
  returnReason: string | null;
  rejectReason: string | null;
  cancelReason: string | null;
}

interface Row {
  id: string;
  doc_type: 'PAY' | 'DPR';
  kind: PaymentRequestKind;
  number: string | null;
  status: PaymentRequestStatus;
  is_advance: boolean;
  po_id: string | null;
  po_number: string | null;
  payee_name_ar: string;
  payee_name_en: string;
  currency: string;
  net: string;
  match_status: MatchStatus;
  created_at: Date;
  version: number;
  office_id: string;
  created_by: string;
  invoice_id: string | null;
  invoice_number: string | null;
  supplier_invoice_no: string | null;
  payee_type: PayeeType;
  supplier_id: string | null;
  staff_payee_id: string | null;
  payee_bank_name: string | null;
  payee_bank_branch: string | null;
  payee_account_name: string | null;
  payee_account_no: string | null;
  grant_id: string;
  grant_code: string;
  grant_currency: string;
  grant_status: string;
  supplier_status: string | null;
  payment_method: PaymentMethod;
  money_account_id: string;
  money_account_name: string;
  money_account_kind: 'bank' | 'cash';
  rate_to_base: string;
  rate_date: string | null;
  rate_source: string | null;
  exchange_rate_id: string | null;
  po_currency: string | null;
  po_rate_to_base: string | null;
  gross: string;
  advance_deduction: string;
  retention_amount: string;
  deductions_total: string;
  po_amount: string;
  amount_in_words_ar: string | null;
  amount_in_words_en: string | null;
  grn_ids: string[];
  certificate_ids: string[];
  paid_on: string | null;
  submission_cycle: number;
  current_step_order: number | null;
  return_reason: string | null;
  reject_reason: string | null;
  cancel_reason: string | null;
  total_count?: number;
}

const toSummary = (r: Row): PaymentRequestSummary => ({
  id: r.id,
  docType: r.doc_type,
  kind: r.kind,
  number: r.number,
  status: r.status,
  isAdvance: r.is_advance,
  poId: r.po_id,
  poNumber: r.po_number,
  payeeNameAr: r.payee_name_ar,
  payeeNameEn: r.payee_name_en,
  currency: r.currency,
  net: r.net,
  matchStatus: r.match_status,
  createdAt: r.created_at.toISOString(),
});

const toRecord = (r: Row): PaymentRequestRecord => ({
  ...toSummary(r),
  version: r.version,
  officeId: r.office_id,
  createdBy: r.created_by,
  invoiceId: r.invoice_id,
  invoiceNumber: r.invoice_number,
  supplierInvoiceNo: r.supplier_invoice_no,
  payeeType: r.payee_type,
  supplierId: r.supplier_id,
  staffPayeeId: r.staff_payee_id,
  payeeBankName: r.payee_bank_name,
  payeeBankBranch: r.payee_bank_branch,
  payeeAccountName: r.payee_account_name,
  payeeAccountNo: r.payee_account_no,
  grantId: r.grant_id,
  grantCode: r.grant_code,
  grantCurrency: r.grant_currency,
  grantStatus: r.grant_status,
  supplierStatus: r.supplier_status,
  paymentMethod: r.payment_method,
  moneyAccountId: r.money_account_id,
  moneyAccountName: r.money_account_name,
  moneyAccountKind: r.money_account_kind,
  rateToBase: r.rate_to_base,
  rateDate: r.rate_date,
  rateSource: r.rate_source,
  exchangeRateId: r.exchange_rate_id,
  poCurrency: r.po_currency,
  poRateToBase: r.po_rate_to_base,
  gross: r.gross,
  advanceDeduction: r.advance_deduction,
  retentionAmount: r.retention_amount,
  deductionsTotal: r.deductions_total,
  poAmount: r.po_amount,
  amountInWordsAr: r.amount_in_words_ar,
  amountInWordsEn: r.amount_in_words_en,
  grnIds: r.grn_ids,
  certificateIds: r.certificate_ids,
  paidOn: r.paid_on,
  submissionCycle: r.submission_cycle,
  currentStepOrder: r.current_step_order,
  returnReason: r.return_reason,
  rejectReason: r.reject_reason,
  cancelReason: r.cancel_reason,
});

/** The header columns written at creation and on every recomputation. */
export interface PaymentRequestValues {
  kind: PaymentRequestKind;
  officeId: string;
  poId: string | null;
  invoiceId: string | null;
  isAdvance: boolean;
  grnIds: readonly string[];
  certificateIds: readonly string[];
  payeeType: PayeeType;
  supplierId: string | null;
  staffPayeeId: string | null;
  payeeName: string | null;
  payeeBankName: string | null;
  payeeBankBranch: string | null;
  payeeAccountName: string | null;
  payeeAccountNo: string | null;
  grantId: string;
  categoryId: string | null;
  periodText: string | null;
  paymentMethod: PaymentMethod;
  moneyAccountId: string;
  currency: string;
  rateToBase: string;
  rateDate: string;
  rateSource: string;
  exchangeRateId: string | null;
  poRateToBase: string | null;
  poExchangeRateId: string | null;
}

export interface PaymentAmounts {
  gross: string;
  advanceDeduction: string;
  retentionAmount: string;
  deductionsTotal: string;
  net: string;
  poAmount: string;
  amountInWordsAr: string | null;
  amountInWordsEn: string | null;
  matchStatus: MatchStatus;
}

export interface PaymentSubmitValues {
  number: string;
  status: string;
  submissionCycle: number;
  currentStepOrder: number;
  submittedAt: string;
  doaCurrency: string;
  doaAmount: string;
  doaRateToBase: string;
  doaRateDate: string;
  doaRateSource: string;
  doaExchangeRateId: string | null;
}

export class PaymentRequestRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  private select(where: postgres.PendingQuery<postgres.Row[]>, tail = this.sql``) {
    return this.sql<Row[]>`
      select r.id, r.doc_type, r.kind, r.number, r.status, r.is_advance, r.po_id,
             p.number as po_number,
             coalesce(s.legal_name_ar, sp.full_name_ar, r.payee_name) as payee_name_ar,
             coalesce(s.legal_name_en, sp.full_name_en, r.payee_name) as payee_name_en,
             r.currency::text, r.net::text, r.match_status, r.created_at, r.version, r.office_id,
             r.created_by, r.invoice_id, i.number as invoice_number, i.supplier_invoice_no,
             r.payee_type, r.supplier_id, r.staff_payee_id, r.payee_bank_name,
             r.payee_bank_branch, r.payee_account_name, r.payee_account_no, r.grant_id,
             g.code as grant_code, g.currency::text as grant_currency, g.status as grant_status,
             s.status as supplier_status, r.payment_method, r.money_account_id,
             m.name as money_account_name, m.kind as money_account_kind,
             r.rate_to_base::text, r.rate_date::text, r.rate_source, r.exchange_rate_id,
             p.currency::text as po_currency, r.po_rate_to_base::text, r.gross::text,
             r.advance_deduction::text, r.retention_amount::text, r.deductions_total::text,
             r.po_amount::text, r.amount_in_words_ar, r.amount_in_words_en,
             r.grn_ids::text[] as grn_ids, r.certificate_ids::text[] as certificate_ids,
             r.paid_on::text, r.submission_cycle, r.current_step_order, r.return_reason,
             r.reject_reason, r.cancel_reason, count(*) over ()::int as total_count
      from public.payment_request r
      join public."grant" g on g.id = r.grant_id
      join public.money_account m on m.id = r.money_account_id
      left join public.purchase_order p on p.id = r.po_id
      left join public.supplier_invoice i on i.id = r.invoice_id
      left join public.supplier s on s.id = r.supplier_id
      left join public.staff_payee sp on sp.id = r.staff_payee_id
      where r.tenant_id = ${this.tenantId} ${where}
      ${tail}`;
  }

  async list(filter: {
    page: number;
    pageSize: number;
    status?: PaymentRequestStatus;
    kind?: PaymentRequestKind;
    poId?: string;
    docType?: 'PAY' | 'DPR';
  }): Promise<ListResponse<PaymentRequestSummary>> {
    const sql = this.sql;
    const { page, pageSize } = filter;
    const rows = await this.select(
      sql`${filter.status ? sql`and r.status = ${filter.status}` : sql``}
          ${filter.kind ? sql`and r.kind = ${filter.kind}` : sql``}
          ${filter.poId ? sql`and r.po_id = ${filter.poId}` : sql``}
          ${filter.docType ? sql`and r.doc_type = ${filter.docType}` : sql``}`,
      sql`order by r.created_at desc, r.id limit ${pageSize} offset ${(page - 1) * pageSize}`
    );
    return { data: rows.map(toSummary), page, pageSize, total: rows[0]?.total_count ?? 0 };
  }

  async find(id: string, options: { lock?: boolean } = {}): Promise<PaymentRequestRecord | null> {
    if (options.lock) {
      const [locked] = await this.sql<{ id: string }[]>`
        select id from public.payment_request
        where tenant_id = ${this.tenantId} and id = ${id} for update`;
      if (!locked) return null;
    }
    const [row] = await this.select(this.sql`and r.id = ${id}`);
    return row ? toRecord(row) : null;
  }

  async get(id: string, options: { lock?: boolean } = {}): Promise<PaymentRequestRecord> {
    const request = await this.find(id, options);
    if (!request) throw new AppError('NOT_FOUND', 'Payment request not found');
    return request;
  }

  async docType(id: string): Promise<'PAY' | 'DPR'> {
    const [row] = await this.sql<{ doc_type: 'PAY' | 'DPR' }[]>`
      select doc_type from public.payment_request where tenant_id = ${this.tenantId} and id = ${id}`;
    if (!row) throw new AppError('NOT_FOUND', 'Payment request not found');
    return row.doc_type;
  }

  private columns(v: PaymentRequestValues) {
    const sql = this.sql;
    return {
      kind: v.kind,
      office_id: v.officeId,
      po_id: v.poId,
      invoice_id: v.invoiceId,
      is_advance: v.isAdvance,
      grn_ids: sql.array([...v.grnIds]),
      certificate_ids: sql.array([...v.certificateIds]),
      payee_type: v.payeeType,
      supplier_id: v.supplierId,
      staff_payee_id: v.staffPayeeId,
      payee_name: v.payeeName,
      payee_bank_name: v.payeeBankName,
      payee_bank_branch: v.payeeBankBranch,
      payee_account_name: v.payeeAccountName,
      payee_account_no: v.payeeAccountNo,
      grant_id: v.grantId,
      category_id: v.categoryId,
      period_text: v.periodText,
      payment_method: v.paymentMethod,
      money_account_id: v.moneyAccountId,
      currency: v.currency,
      rate_to_base: v.rateToBase,
      rate_date: v.rateDate,
      rate_source: v.rateSource,
      exchange_rate_id: v.exchangeRateId,
      po_rate_to_base: v.poRateToBase,
      po_exchange_rate_id: v.poExchangeRateId,
    };
  }

  private amountColumns(a: PaymentAmounts) {
    return {
      gross: a.gross,
      advance_deduction: a.advanceDeduction,
      retention_amount: a.retentionAmount,
      deductions_total: a.deductionsTotal,
      net: a.net,
      po_amount: a.poAmount,
      amount_in_words_ar: a.amountInWordsAr,
      amount_in_words_en: a.amountInWordsEn,
      match_status: a.matchStatus,
    };
  }

  async insert(values: PaymentRequestValues, amounts: PaymentAmounts): Promise<string> {
    const sql = this.sql;
    const row = {
      tenant_id: this.tenantId,
      ...this.columns(values),
      ...this.amountColumns(amounts),
    };
    const [inserted] = await sql<{ id: string }[]>`
      insert into public.payment_request ${sql(row)} returning id`;
    return inserted!.id;
  }

  /** Recomputation of a draft: the editable header columns and every amount. */
  async rewrite(
    id: string,
    expectedVersion: number,
    values: Pick<PaymentRequestValues, 'paymentMethod' | 'moneyAccountId'> &
      Partial<
        Pick<
          PaymentRequestValues,
          | 'rateToBase'
          | 'rateDate'
          | 'rateSource'
          | 'exchangeRateId'
          | 'poRateToBase'
          | 'poExchangeRateId'
        >
      >,
    amounts: PaymentAmounts
  ): Promise<void> {
    const sql = this.sql;
    const changes: Record<string, unknown> = {
      payment_method: values.paymentMethod,
      money_account_id: values.moneyAccountId,
      ...this.amountColumns(amounts),
    };
    if (values.rateToBase !== undefined) changes.rate_to_base = values.rateToBase;
    if (values.rateDate !== undefined) changes.rate_date = values.rateDate;
    if (values.rateSource !== undefined) changes.rate_source = values.rateSource;
    if (values.exchangeRateId !== undefined) changes.exchange_rate_id = values.exchangeRateId;
    if (values.poRateToBase !== undefined) changes.po_rate_to_base = values.poRateToBase;
    if (values.poExchangeRateId !== undefined)
      changes.po_exchange_rate_id = values.poExchangeRateId;
    const rows = await sql`
      update public.payment_request set ${sql(changes)}
      where tenant_id = ${this.tenantId} and id = ${id} and version = ${expectedVersion}
      returning id`;
    if (rows.length === 0) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
  }

  async setMatchStatus(id: string, expectedVersion: number, status: MatchStatus): Promise<void> {
    const rows = await this.sql`
      update public.payment_request set match_status = ${status}
      where tenant_id = ${this.tenantId} and id = ${id} and version = ${expectedVersion}
      returning id`;
    if (rows.length === 0) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
  }

  async markSubmitted(id: string, v: PaymentSubmitValues): Promise<number> {
    const [row] = await this.sql<{ version: number }[]>`
      update public.payment_request
      set number = ${v.number}, status = ${v.status}, submission_cycle = ${v.submissionCycle},
          current_step_order = ${v.currentStepOrder}, submitted_at = ${v.submittedAt},
          return_reason = null, doa_currency = ${v.doaCurrency}, doa_amount = ${v.doaAmount},
          doa_rate_to_base = ${v.doaRateToBase}, doa_rate_date = ${v.doaRateDate},
          doa_rate_source = ${v.doaRateSource}, doa_exchange_rate_id = ${v.doaExchangeRateId}
      where tenant_id = ${this.tenantId} and id = ${id}
      returning version`;
    return row!.version;
  }

  /** Workflow status changes (advance, approve, reject, return, cancel, touch). */
  async updateWorkflow(
    id: string,
    values: {
      status?: string;
      currentStepOrder?: number | null;
      approvedAt?: string;
      rejectReason?: string;
      returnReason?: string;
      cancelReason?: string;
      cancelledAt?: string;
      frozenGrantOverride?: Record<string, unknown>;
    }
  ): Promise<number> {
    const sql = this.sql;
    const changes: Record<string, unknown> = {};
    if (values.status !== undefined) changes.status = values.status;
    if (values.currentStepOrder !== undefined) changes.current_step_order = values.currentStepOrder;
    if (values.approvedAt !== undefined) changes.approved_at = values.approvedAt;
    if (values.rejectReason !== undefined) changes.reject_reason = values.rejectReason;
    if (values.returnReason !== undefined) changes.return_reason = values.returnReason;
    if (values.cancelReason !== undefined) changes.cancel_reason = values.cancelReason;
    if (values.cancelledAt !== undefined) changes.cancelled_at = values.cancelledAt;
    if (values.frozenGrantOverride !== undefined) {
      changes.frozen_grant_override = sql.json(
        values.frozenGrantOverride as Parameters<TxSql['json']>[0]
      );
    }
    const [row] = await sql<{ version: number }[]>`
      update public.payment_request
      set ${Object.keys(changes).length ? sql(changes) : sql`updated_at = now()`}
      where tenant_id = ${this.tenantId} and id = ${id}
      returning version`;
    return row!.version;
  }

  /** Σ po_amount of the PO's live order requests other than `exceptId` (FR-060). */
  async requestedOnPo(poId: string, exceptId: string | null): Promise<string> {
    const [row] = await this.sql<{ total: string }[]>`
      select coalesce(sum(po_amount), 0)::text as total from public.payment_request
      where tenant_id = ${this.tenantId} and po_id = ${poId} and kind = 'order'
        and status not in ('cancelled', 'rejected')
        and (${exceptId}::uuid is null or id <> ${exceptId}::uuid)`;
    return row!.total;
  }

  /**
   * The PO's live order requests other than `exceptId`, in the PO currency: advances requested,
   * advances paid or approved, advances already deducted, and the gross of non-advance requests.
   */
  async poFigures(
    poId: string,
    exceptId: string | null
  ): Promise<{
    advancesRequested: string;
    advancesPaid: string;
    advancesDeducted: string;
    invoicedGross: string;
    retentionWithheld: string;
    retentionReleased: string;
  }> {
    const [row] = await this.sql<
      {
        advances_requested: string;
        advances_paid: string;
        advances_deducted: string;
        invoiced_gross: string;
        retention_withheld: string;
        retention_released: string;
      }[]
    >`
      select
        coalesce(sum(r.po_amount) filter (where r.is_advance), 0)::text as advances_requested,
        coalesce(sum(r.po_amount) filter (
          where r.is_advance and r.status in ('approved', 'paid')), 0)::text as advances_paid,
        coalesce(sum(round(r.advance_deduction * r.rate_to_base / coalesce(r.po_rate_to_base, r.rate_to_base), 2))
          filter (where r.kind = 'order' and not r.is_advance), 0)::text as advances_deducted,
        coalesce(sum(r.po_amount + round(r.advance_deduction * r.rate_to_base / coalesce(r.po_rate_to_base, r.rate_to_base), 2))
          filter (where r.kind = 'order' and not r.is_advance), 0)::text as invoiced_gross,
        coalesce(sum(round(r.retention_amount * r.rate_to_base / coalesce(r.po_rate_to_base, r.rate_to_base), 2))
          filter (where r.kind = 'order' and not r.is_advance), 0)::text as retention_withheld,
        coalesce(sum(round(r.gross * r.rate_to_base / coalesce(r.po_rate_to_base, r.rate_to_base), 2))
          filter (where r.kind = 'retention'), 0)::text as retention_released
      from public.payment_request r
      where r.tenant_id = ${this.tenantId} and r.po_id = ${poId}
        and r.status not in ('cancelled', 'rejected')
        and (${exceptId}::uuid is null or r.id <> ${exceptId}::uuid)`;
    return {
      advancesRequested: row!.advances_requested,
      advancesPaid: row!.advances_paid,
      advancesDeducted: row!.advances_deducted,
      invoicedGross: row!.invoiced_gross,
      retentionWithheld: row!.retention_withheld,
      retentionReleased: row!.retention_released,
    };
  }

  /** The live request that uses an invoice, if any. */
  async forInvoice(
    invoiceId: string
  ): Promise<{ id: string; number: string | null; status: string } | null> {
    const [row] = await this.sql<{ id: string; number: string | null; status: string }[]>`
      select id, number, status from public.payment_request
      where tenant_id = ${this.tenantId} and invoice_id = ${invoiceId}
        and status not in ('cancelled', 'rejected')`;
    return row ?? null;
  }
}
