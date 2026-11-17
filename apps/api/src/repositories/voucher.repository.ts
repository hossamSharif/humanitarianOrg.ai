// voucher (002 data-model §8, research D5): the header of every BPV / CPV / BRV / CRV / JV / TRF.
// Once posted the row is immutable (trigger app.voucher_immutable_when_posted) except that its
// reversal is stamped once; posting into a closed month is refused by app.voucher_period_open.
import type { ListResponse, VoucherStatus, VoucherSummary, VoucherType } from '@ngo/shared';
import type postgres from 'postgres';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

type Json = Parameters<TxSql['json']>[0];

export interface VoucherRecord extends VoucherSummary {
  version: number;
  officeId: string;
  enteredBy: string;
  moneyAccountId: string | null;
  moneyAccountKind: 'bank' | 'cash' | null;
  paymentMethod: string | null;
  chequeNo: string | null;
  reason: string | null;
  amountInWordsAr: string | null;
  amountInWordsEn: string | null;
  grantId: string | null;
  grantStatus: string | null;
  postedAt: string | null;
  postedBy: string | null;
  receivedByName: string | null;
  receivedOn: string | null;
  receivedCopyAttachmentId: string | null;
  reversedAt: string | null;
  submissionCycle: number;
  currentStepOrder: number | null;
  returnReason: string | null;
  cancelReason: string | null;
}

interface Row {
  id: string;
  type: VoucherType;
  number: string | null;
  status: VoucherStatus;
  voucher_date: string;
  payee_name: string | null;
  currency: string;
  amount: string;
  money_account_name: string | null;
  payment_request_id: string | null;
  reversal_of_id: string | null;
  reversed_by_id: string | null;
  created_at: Date;
  version: number;
  office_id: string;
  entered_by: string;
  money_account_id: string | null;
  money_account_kind: 'bank' | 'cash' | null;
  payment_method: string | null;
  cheque_no: string | null;
  reason: string | null;
  amount_in_words_ar: string | null;
  amount_in_words_en: string | null;
  grant_id: string | null;
  grant_status: string | null;
  posted_at: Date | null;
  posted_by: string | null;
  received_by_name: string | null;
  received_on: string | null;
  received_copy_attachment_id: string | null;
  reversed_at: Date | null;
  submission_cycle: number;
  current_step_order: number | null;
  return_reason: string | null;
  cancel_reason: string | null;
  total_count?: number;
}

const toSummary = (r: Row): VoucherSummary => ({
  id: r.id,
  type: r.type,
  number: r.number,
  status: r.status,
  voucherDate: r.voucher_date,
  payeeName: r.payee_name,
  currency: r.currency,
  amount: r.amount,
  moneyAccountName: r.money_account_name,
  paymentRequestId: r.payment_request_id,
  reversalOfId: r.reversal_of_id,
  reversedById: r.reversed_by_id,
  createdAt: r.created_at.toISOString(),
});

const toRecord = (r: Row): VoucherRecord => ({
  ...toSummary(r),
  version: r.version,
  officeId: r.office_id,
  enteredBy: r.entered_by,
  moneyAccountId: r.money_account_id,
  moneyAccountKind: r.money_account_kind,
  paymentMethod: r.payment_method,
  chequeNo: r.cheque_no,
  reason: r.reason,
  amountInWordsAr: r.amount_in_words_ar,
  amountInWordsEn: r.amount_in_words_en,
  grantId: r.grant_id,
  grantStatus: r.grant_status,
  postedAt: r.posted_at?.toISOString() ?? null,
  postedBy: r.posted_by,
  receivedByName: r.received_by_name,
  receivedOn: r.received_on,
  receivedCopyAttachmentId: r.received_copy_attachment_id,
  reversedAt: r.reversed_at?.toISOString() ?? null,
  submissionCycle: r.submission_cycle,
  currentStepOrder: r.current_step_order,
  returnReason: r.return_reason,
  cancelReason: r.cancel_reason,
});

export interface NewVoucher {
  type: VoucherType;
  officeId: string;
  voucherDate: string;
  moneyAccountId: string | null;
  paymentMethod: string | null;
  chequeNo: string | null;
  payeeName: string | null;
  currency: string;
  amount: string;
  amountInWordsAr: string | null;
  amountInWordsEn: string | null;
  reason: string | null;
  paymentRequestId: string | null;
  grantId: string | null;
  reversalOfId: string | null;
}

export class VoucherRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  private select(where: postgres.PendingQuery<postgres.Row[]>, tail = this.sql``) {
    return this.sql<Row[]>`
      select v.id, v.type, v.number, v.status, v.voucher_date::text, v.payee_name,
             v.currency::text, v.amount::text, m.name as money_account_name,
             v.payment_request_id, v.reversal_of_id, v.reversed_by_id, v.created_at, v.version,
             v.office_id, v.entered_by, v.money_account_id, m.kind as money_account_kind,
             v.payment_method, v.cheque_no, v.reason, v.amount_in_words_ar, v.amount_in_words_en,
             v.grant_id, g.status as grant_status, v.posted_at, v.posted_by, v.received_by_name,
             v.received_on::text, v.received_copy_attachment_id, v.reversed_at,
             v.submission_cycle, v.current_step_order, v.return_reason, v.cancel_reason,
             count(*) over ()::int as total_count
      from public.voucher v
      left join public.money_account m on m.id = v.money_account_id
      left join public."grant" g on g.id = v.grant_id
      where v.tenant_id = ${this.tenantId} ${where}
      ${tail}`;
  }

  async list(filter: {
    page: number;
    pageSize: number;
    type?: VoucherType;
    status?: VoucherStatus;
    paymentRequestId?: string;
  }): Promise<ListResponse<VoucherSummary>> {
    const sql = this.sql;
    const { page, pageSize } = filter;
    const rows = await this.select(
      sql`${filter.type ? sql`and v.type = ${filter.type}` : sql``}
          ${filter.status ? sql`and v.status = ${filter.status}` : sql``}
          ${filter.paymentRequestId ? sql`and v.payment_request_id = ${filter.paymentRequestId}` : sql``}`,
      sql`order by v.voucher_date desc, v.created_at desc, v.id
          limit ${pageSize} offset ${(page - 1) * pageSize}`
    );
    return { data: rows.map(toSummary), page, pageSize, total: rows[0]?.total_count ?? 0 };
  }

  async find(id: string, options: { lock?: boolean } = {}): Promise<VoucherRecord | null> {
    if (options.lock) {
      const [locked] = await this.sql<{ id: string }[]>`
        select id from public.voucher where tenant_id = ${this.tenantId} and id = ${id} for update`;
      if (!locked) return null;
    }
    const [row] = await this.select(this.sql`and v.id = ${id}`);
    return row ? toRecord(row) : null;
  }

  async get(id: string, options: { lock?: boolean } = {}): Promise<VoucherRecord> {
    const voucher = await this.find(id, options);
    if (!voucher) throw new AppError('NOT_FOUND', 'Voucher not found');
    return voucher;
  }

  async typeOf(id: string): Promise<VoucherType> {
    const [row] = await this.sql<{ type: VoucherType }[]>`
      select type from public.voucher where tenant_id = ${this.tenantId} and id = ${id}`;
    if (!row) throw new AppError('NOT_FOUND', 'Voucher not found');
    return row.type;
  }

  /** The live voucher of a payment request (reversals and reversed ones aside). */
  async liveForPaymentRequest(paymentRequestId: string): Promise<string | null> {
    const [row] = await this.sql<{ id: string }[]>`
      select id from public.voucher
      where tenant_id = ${this.tenantId} and payment_request_id = ${paymentRequestId}
        and reversal_of_id is null and reversed_by_id is null and status <> 'cancelled'`;
    return row?.id ?? null;
  }

  async liveReversalOf(id: string): Promise<string | null> {
    const [row] = await this.sql<{ id: string }[]>`
      select id from public.voucher
      where tenant_id = ${this.tenantId} and reversal_of_id = ${id} and status <> 'cancelled'`;
    return row?.id ?? null;
  }

  async insert(v: NewVoucher): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.voucher
        (tenant_id, type, office_id, voucher_date, money_account_id, payment_method, cheque_no,
         payee_name, currency, amount, amount_in_words_ar, amount_in_words_en, reason,
         payment_request_id, grant_id, reversal_of_id)
      values (${this.tenantId}, ${v.type}, ${v.officeId}, ${v.voucherDate}, ${v.moneyAccountId},
              ${v.paymentMethod}, ${v.chequeNo}, ${v.payeeName}, ${v.currency}, ${v.amount},
              ${v.amountInWordsAr}, ${v.amountInWordsEn}, ${v.reason}, ${v.paymentRequestId},
              ${v.grantId}, ${v.reversalOfId})
      returning id`;
    return row!.id;
  }

  async markSubmitted(
    id: string,
    v: {
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
  ): Promise<number> {
    const [row] = await this.sql<{ version: number }[]>`
      update public.voucher
      set number = ${v.number}, status = ${v.status}, submission_cycle = ${v.submissionCycle},
          current_step_order = ${v.currentStepOrder}, submitted_at = ${v.submittedAt},
          return_reason = null, doa_currency = ${v.doaCurrency}, doa_amount = ${v.doaAmount},
          doa_rate_to_base = ${v.doaRateToBase}, doa_rate_date = ${v.doaRateDate},
          doa_rate_source = ${v.doaRateSource}, doa_exchange_rate_id = ${v.doaExchangeRateId}
      where tenant_id = ${this.tenantId} and id = ${id}
      returning version`;
    return row!.version;
  }

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
    const [row] = await sql<{ version: number }[]>`
      update public.voucher
      set ${Object.keys(changes).length ? sql(changes) : sql`updated_at = now()`}
      where tenant_id = ${this.tenantId} and id = ${id}
      returning version`;
    return row!.version;
  }

  /** approved → posted, with the received-by fields and the frozen print snapshot. */
  async markPosted(
    id: string,
    expectedVersion: number,
    v: {
      userId: string;
      receivedByName: string | null;
      receivedOn: string | null;
      receivedCopyAttachmentId: string | null;
      printSnapshot: Record<string, unknown>;
    }
  ): Promise<void> {
    const rows = await this.sql`
      update public.voucher
      set status = 'posted', posted_at = now(), posted_by = ${v.userId},
          received_by_name = coalesce(${v.receivedByName}, received_by_name),
          received_on = coalesce(${v.receivedOn}::date, received_on),
          received_copy_attachment_id =
            coalesce(${v.receivedCopyAttachmentId}::uuid, received_copy_attachment_id),
          print_snapshot = ${this.sql.json(v.printSnapshot as Json)}
      where tenant_id = ${this.tenantId} and id = ${id} and version = ${expectedVersion}
        and status = 'approved'
      returning id`;
    if (rows.length === 0) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
  }

  /** The original of a posted reversal: stamped once (the only change a posted voucher takes). */
  async stampReversed(id: string, reversedById: string): Promise<void> {
    await this.sql`
      update public.voucher set reversed_by_id = ${reversedById}, reversed_at = now()
      where tenant_id = ${this.tenantId} and id = ${id} and reversed_by_id is null`;
  }
}
