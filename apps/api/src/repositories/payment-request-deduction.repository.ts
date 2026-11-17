// payment_request_deduction (002 data-model §7): one row per applied deduction type with its
// base, rate and amount (checked = round(base × rate ÷ 100, 2)) and the payable account copied
// from the type; the deduction types themselves come from the procurement configuration.
import type { DeductionAppliesTo, PaymentDeductionView } from '@ngo/shared';
import type { TxSql } from '../db/tx';

type Json = Parameters<TxSql['json']>[0];

export interface ActiveDeductionType {
  id: string;
  ratePct: string;
  appliesTo: DeductionAppliesTo;
  payableAccountId: string;
}

export interface NewPaymentDeduction {
  deductionTypeId: string;
  base: string;
  ratePct: string;
  amount: string;
  payableAccountId: string;
}

export class PaymentRequestDeductionRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async activeTypes(): Promise<ActiveDeductionType[]> {
    const rows = await this.sql<
      { id: string; rate_pct: string; applies_to: DeductionAppliesTo; payable_account_id: string }[]
    >`
      select id, rate_pct::text, applies_to, payable_account_id from public.deduction_type
      where tenant_id = ${this.tenantId} and is_active
      order by name_en`;
    return rows.map((r) => ({
      id: r.id,
      ratePct: r.rate_pct,
      appliesTo: r.applies_to,
      payableAccountId: r.payable_account_id,
    }));
  }

  async replace(requestId: string, rows: readonly NewPaymentDeduction[]): Promise<void> {
    const sql = this.sql;
    await sql`
      delete from public.payment_request_deduction
      where tenant_id = ${this.tenantId} and payment_request_id = ${requestId}`;
    if (rows.length === 0) return;
    await sql`
      insert into public.payment_request_deduction
        (tenant_id, payment_request_id, deduction_type_id, base, rate_pct, amount,
         payable_account_id)
      select ${this.tenantId}, ${requestId}, x."deductionTypeId", x.base, x."ratePct", x.amount,
             x."payableAccountId"
      from jsonb_to_recordset(${sql.json(rows as unknown as Json)}) as x (
        "deductionTypeId" uuid, base numeric, "ratePct" numeric, amount numeric,
        "payableAccountId" uuid
      )`;
  }

  async list(requestId: string): Promise<(PaymentDeductionView & { payableAccountId: string })[]> {
    const rows = await this.sql<
      {
        id: string;
        deduction_type_id: string;
        name_ar: string;
        name_en: string;
        base: string;
        rate_pct: string;
        amount: string;
        payable_account_id: string;
      }[]
    >`
      select d.id, d.deduction_type_id, t.name_ar, t.name_en, d.base::text, d.rate_pct::text,
             d.amount::text, d.payable_account_id
      from public.payment_request_deduction d
      join public.deduction_type t on t.id = d.deduction_type_id
      where d.tenant_id = ${this.tenantId} and d.payment_request_id = ${requestId}
      order by t.name_en`;
    return rows.map((r) => ({
      id: r.id,
      deductionTypeId: r.deduction_type_id,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      base: r.base,
      ratePct: r.rate_pct,
      amount: r.amount,
      payableAccountId: r.payable_account_id,
    }));
  }
}
