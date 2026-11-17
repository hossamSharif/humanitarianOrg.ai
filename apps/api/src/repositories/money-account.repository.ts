// money_account: bank accounts and cash boxes (002 data-model §6). The read side serves the
// payment-request picker (US11); the writes arrive with the accounting setup (US12). The ledger
// account must be a posting asset account of its own (trigger app.money_account_gl_check).
import type { MoneyAccountView } from '@ngo/shared';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

interface Row {
  id: string;
  kind: 'bank' | 'cash';
  name: string;
  bank_name: string | null;
  branch: string | null;
  account_no: string | null;
  currency: string;
  office_id: string;
  office_code: string;
  gl_account_id: string;
  gl_account_code: string;
  custodian_user_id: string | null;
  opening_balance: string;
  opening_date: string | null;
  is_active: boolean;
  version: number;
}

const toView = (r: Row): MoneyAccountView => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  bankName: r.bank_name,
  branch: r.branch,
  accountNo: r.account_no,
  currency: r.currency,
  officeId: r.office_id,
  officeCode: r.office_code,
  glAccountId: r.gl_account_id,
  glAccountCode: r.gl_account_code,
  custodianUserId: r.custodian_user_id,
  openingBalance: r.opening_balance,
  openingDate: r.opening_date,
  isActive: r.is_active,
  version: r.version,
});

export class MoneyAccountRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  private select(where = this.sql``) {
    return this.sql<Row[]>`
      select m.id, m.kind, m.name, m.bank_name, m.branch, m.account_no, m.currency::text,
             m.office_id, o.code as office_code, m.gl_account_id, g.code as gl_account_code,
             m.custodian_user_id, m.opening_balance::text, m.opening_date::text, m.is_active,
             m.version
      from public.money_account m
      join public.office o on o.id = m.office_id
      join public.gl_account g on g.id = m.gl_account_id
      where m.tenant_id = ${this.tenantId} ${where}
      order by m.name`;
  }

  async list(filter: {
    kind: 'bank' | 'cash';
    currency?: string;
    officeId?: string;
    includeInactive?: boolean;
  }): Promise<MoneyAccountView[]> {
    const sql = this.sql;
    const rows = await this.select(
      sql`and m.kind = ${filter.kind}
          ${filter.currency ? sql`and m.currency = ${filter.currency}` : sql``}
          ${filter.officeId ? sql`and m.office_id = ${filter.officeId}` : sql``}
          ${filter.includeInactive ? sql`` : sql`and m.is_active`}`
    );
    return rows.map(toView);
  }

  async find(id: string): Promise<MoneyAccountView | null> {
    const [row] = await this.select(this.sql`and m.id = ${id}`);
    return row ? toView(row) : null;
  }

  async get(id: string): Promise<MoneyAccountView> {
    const account = await this.find(id);
    if (!account) throw new AppError('NOT_FOUND', 'Bank or cash account not found');
    return account;
  }
}
