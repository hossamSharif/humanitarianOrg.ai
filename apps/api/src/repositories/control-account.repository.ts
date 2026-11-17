// control_account_setting (002 data-model §6): the accounts the voucher generator posts to for
// staff and supplier advances, retention, grant funds (per grant), exchange differences, opening
// balances and suspense. The trigger keeps each one on a posting account.
import type { ControlAccountKey, ControlAccountView } from '@ngo/shared';
import type { TxSql } from '../db/tx';

export class ControlAccountRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async list(): Promise<ControlAccountView[]> {
    const rows = await this.sql<
      {
        key: ControlAccountKey;
        grant_id: string | null;
        grant_code: string | null;
        account_id: string;
        account_code: string;
      }[]
    >`
      select s.key, s.grant_id, gr.code as grant_code, s.account_id, g.code as account_code
      from public.control_account_setting s
      join public.gl_account g on g.id = s.account_id
      left join public."grant" gr on gr.id = s.grant_id
      where s.tenant_id = ${this.tenantId}
      order by s.key, gr.code nulls first`;
    return rows.map((r) => ({
      key: r.key,
      grantId: r.grant_id,
      grantCode: r.grant_code,
      accountId: r.account_id,
      accountCode: r.account_code,
    }));
  }

  async upsert(key: ControlAccountKey, grantId: string | null, accountId: string): Promise<void> {
    await this.sql`
      insert into public.control_account_setting (tenant_id, key, grant_id, account_id)
      values (${this.tenantId}, ${key}, ${grantId}, ${accountId})
      on conflict on constraint control_account_setting_scope_key do update
      set account_id = excluded.account_id, updated_at = now()`;
  }

  /** The account for `key`; grant funds fall back from the grant's own to the org default. */
  async accountFor(key: ControlAccountKey, grantId: string | null = null): Promise<string | null> {
    const [row] = await this.sql<{ account_id: string }[]>`
      select account_id from public.control_account_setting
      where tenant_id = ${this.tenantId} and key = ${key}
        and (grant_id = ${grantId} or grant_id is null)
      order by grant_id nulls last
      limit 1`;
    return row?.account_id ?? null;
  }
}
