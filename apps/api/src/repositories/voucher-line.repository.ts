// voucher_line (002 data-model §8): amounts in the line currency with the rate of the voucher
// date and the base amounts the database checks; dimensions, donor and the "Contract" text; the
// grant rate, Actual and the commitment consumed, stamped at posting. The guard trigger refuses
// changes once the voucher is posted, contradicting rates and inherited-field mismatches.
import type { VoucherDraftLine, VoucherLineView } from '@ngo/shared';
import type { TxSql } from '../db/tx';

type Json = Parameters<TxSql['json']>[0];

export interface VoucherLineRecord extends VoucherLineView {
  accountType: string;
  rateSource: string;
  exchangeRateId: string | null;
  grantCurrency: string | null;
  paymentRequestLineId: string | null;
  poLineId: string | null;
  consumedCommitmentId: string | null;
  grantRateToBase: string | null;
}

export type NewVoucherLine = Omit<VoucherDraftLine, 'isMoneySide'>;

export class VoucherLineRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async insertMany(voucherId: string, lines: readonly NewVoucherLine[]): Promise<void> {
    const sql = this.sql;
    const rows = lines.map((l, i) => ({ ...l, lineNo: i + 1 }));
    await sql`
      insert into public.voucher_line
        (tenant_id, voucher_id, line_no, account_id, description, currency, debit, credit,
         rate_to_base, rate_date, rate_source, exchange_rate_id, base_debit, base_credit,
         grant_id, budget_line_id, location_office_id, activity_id, donor_id, category_text,
         actual_grant_amount, payment_request_line_id, po_line_id)
      select ${this.tenantId}, ${voucherId}, x."lineNo", x."accountId", x.description, x.currency,
             x.debit, x.credit, x."rateToBase", x."rateDate", x."rateSource", x."exchangeRateId",
             x."baseDebit", x."baseCredit", x."grantId", x."budgetLineId", x."locationOfficeId",
             x."activityId", x."donorId", x."categoryText", x."actualGrantAmount",
             x."paymentRequestLineId", x."poLineId"
      from jsonb_to_recordset(${sql.json(rows as unknown as Json)}) as x (
        "lineNo" smallint, "accountId" uuid, description text, currency text, debit numeric,
        credit numeric, "rateToBase" numeric, "rateDate" date, "rateSource" text,
        "exchangeRateId" uuid, "baseDebit" numeric, "baseCredit" numeric, "grantId" uuid,
        "budgetLineId" uuid, "locationOfficeId" uuid, "activityId" uuid, "donorId" uuid,
        "categoryText" text, "actualGrantAmount" numeric, "paymentRequestLineId" uuid,
        "poLineId" uuid
      )`;
  }

  async list(voucherId: string): Promise<VoucherLineRecord[]> {
    const rows = await this.sql<
      {
        id: string;
        line_no: number;
        account_id: string;
        account_code: string;
        account_name_ar: string;
        account_name_en: string;
        account_type: string;
        description: string | null;
        currency: string;
        debit: string;
        credit: string;
        rate_to_base: string;
        rate_date: string;
        rate_source: string;
        exchange_rate_id: string | null;
        base_debit: string;
        base_credit: string;
        grant_id: string | null;
        grant_currency: string | null;
        budget_line_id: string | null;
        budget_line_code: string | null;
        location_office_id: string | null;
        activity_id: string | null;
        donor_id: string | null;
        donor_name: string | null;
        category_text: string | null;
        actual_grant_amount: string | null;
        commitment_consumed_grant: string | null;
        consumed_commitment_id: string | null;
        grant_rate_to_base: string | null;
        posted_period: string | null;
        payment_request_line_id: string | null;
        po_line_id: string | null;
      }[]
    >`
      select l.id, l.line_no, l.account_id, a.code as account_code, a.name_ar as account_name_ar,
             a.name_en as account_name_en, a.type as account_type, l.description,
             l.currency::text, l.debit::text, l.credit::text, l.rate_to_base::text,
             l.rate_date::text, l.rate_source, l.exchange_rate_id, l.base_debit::text,
             l.base_credit::text, l.grant_id, g.currency::text as grant_currency,
             l.budget_line_id, b.code as budget_line_code, l.location_office_id, l.activity_id,
             l.donor_id, d.name as donor_name, l.category_text, l.actual_grant_amount::text,
             l.commitment_consumed_grant::text, l.consumed_commitment_id,
             l.grant_rate_to_base::text, l.posted_period::text, l.payment_request_line_id,
             l.po_line_id
      from public.voucher_line l
      join public.gl_account a on a.id = l.account_id
      left join public."grant" g on g.id = l.grant_id
      left join public.budget_line b on b.id = l.budget_line_id
      left join public.donor d on d.id = l.donor_id
      where l.tenant_id = ${this.tenantId} and l.voucher_id = ${voucherId}
      order by l.line_no`;
    return rows.map((r) => ({
      id: r.id,
      lineNo: r.line_no,
      accountId: r.account_id,
      accountCode: r.account_code,
      accountNameAr: r.account_name_ar,
      accountNameEn: r.account_name_en,
      accountType: r.account_type,
      description: r.description,
      currency: r.currency,
      debit: r.debit,
      credit: r.credit,
      rateToBase: r.rate_to_base,
      rateDate: r.rate_date,
      rateSource: r.rate_source,
      exchangeRateId: r.exchange_rate_id,
      baseDebit: r.base_debit,
      baseCredit: r.base_credit,
      grantId: r.grant_id,
      grantCurrency: r.grant_currency,
      budgetLineId: r.budget_line_id,
      budgetLineCode: r.budget_line_code,
      locationOfficeId: r.location_office_id,
      activityId: r.activity_id,
      donorId: r.donor_id,
      donorName: r.donor_name,
      categoryText: r.category_text,
      actualGrantAmount: r.actual_grant_amount,
      commitmentConsumedGrant: r.commitment_consumed_grant,
      consumedCommitmentId: r.consumed_commitment_id,
      grantRateToBase: r.grant_rate_to_base,
      postedPeriod: r.posted_period,
      paymentRequestLineId: r.payment_request_line_id,
      poLineId: r.po_line_id,
    }));
  }

  /** Posting: the grant rate, Actual, the consumed commitment and the period, per line. */
  async stampPosting(
    lineId: string,
    v: {
      grantRateToBase: string | null;
      grantRateDate: string | null;
      grantRateSource: string | null;
      grantExchangeRateId: string | null;
      actualGrantAmount: string | null;
      commitmentConsumedGrant: string | null;
      consumedCommitmentId: string | null;
      postedPeriod: string;
    }
  ): Promise<void> {
    await this.sql`
      update public.voucher_line
      set grant_rate_to_base = ${v.grantRateToBase}, grant_rate_date = ${v.grantRateDate},
          grant_rate_source = ${v.grantRateSource},
          grant_exchange_rate_id = ${v.grantExchangeRateId},
          actual_grant_amount = ${v.actualGrantAmount},
          commitment_consumed_grant = ${v.commitmentConsumedGrant},
          consumed_commitment_id = ${v.consumedCommitmentId},
          posted_period = ${v.postedPeriod}
      where tenant_id = ${this.tenantId} and id = ${lineId}`;
  }
}
