// payment_match_override (002 data-model §7, FR-056): at most one per request, with its reason;
// the overriding user is created_by (auth.uid()), and a trigger refuses the preparer.
import type { TxSql } from '../db/tx';

export interface PaymentMatchOverrideRecord {
  reason: string;
  userId: string;
  userName: string;
  at: string;
}

export class PaymentMatchOverrideRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async find(requestId: string): Promise<PaymentMatchOverrideRecord | null> {
    const [row] = await this.sql<
      { reason: string; created_by: string; user_name: string | null; at: string }[]
    >`
      select o.reason, o.created_by, m.full_name_en as user_name,
             to_json(o.created_at)#>>'{}' as at
      from public.payment_match_override o
      left join public.membership m on m.tenant_id = o.tenant_id and m.user_id = o.created_by
      where o.tenant_id = ${this.tenantId} and o.payment_request_id = ${requestId}`;
    return row
      ? { reason: row.reason, userId: row.created_by, userName: row.user_name ?? '', at: row.at }
      : null;
  }

  async insert(requestId: string, reason: string): Promise<void> {
    await this.sql`
      insert into public.payment_match_override (tenant_id, payment_request_id, reason)
      values (${this.tenantId}, ${requestId}, ${reason})`;
  }

  /** A recomputed draft loses its override (the match is decided again). */
  async remove(requestId: string): Promise<void> {
    await this.sql`
      delete from public.payment_match_override
      where tenant_id = ${this.tenantId} and payment_request_id = ${requestId}`;
  }
}
