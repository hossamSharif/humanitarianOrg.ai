// accounting_period (002 data-model §6, research R33): one row per month, open or closed. Posting
// reads the period of the voucher date FOR SHARE, so a concurrent close waits for it; closing
// and reopening lock the row FOR UPDATE. Periods are never deleted.
import type {
  AccountingPeriodStatus,
  AccountingPeriodView,
  UnpostedVoucherView,
} from '@ngo/shared';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

interface Row {
  id: string;
  year: number;
  month: number;
  status: AccountingPeriodStatus;
  closed_at: Date | null;
  closed_by: string | null;
  reopened_at: Date | null;
  reopened_by: string | null;
  reopen_reason: string | null;
  version: number;
}

const toView = (r: Row): AccountingPeriodView => ({
  id: r.id,
  year: r.year,
  month: r.month,
  status: r.status,
  closedAt: r.closed_at?.toISOString() ?? null,
  closedBy: r.closed_by,
  reopenedAt: r.reopened_at?.toISOString() ?? null,
  reopenedBy: r.reopened_by,
  reopenReason: r.reopen_reason,
  version: r.version,
});

const COLUMNS = `id, year, month, status, closed_at, closed_by, reopened_at, reopened_by,
  reopen_reason, version`;

export class AccountingPeriodRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async list(): Promise<AccountingPeriodView[]> {
    const rows = await this.sql<Row[]>`
      select ${this.sql.unsafe(COLUMNS)} from public.accounting_period
      where tenant_id = ${this.tenantId}
      order by year desc, month desc`;
    return rows.map(toView);
  }

  async get(id: string, options: { lock?: boolean } = {}): Promise<AccountingPeriodView> {
    const [row] = await this.sql<Row[]>`
      select ${this.sql.unsafe(COLUMNS)} from public.accounting_period
      where tenant_id = ${this.tenantId} and id = ${id}
      ${options.lock ? this.sql`for update` : this.sql``}`;
    if (!row) throw new AppError('NOT_FOUND', 'Accounting period not found');
    return toView(row);
  }

  /** The period of a date, read FOR SHARE (posting); null when it does not exist. */
  async forDate(date: string): Promise<AccountingPeriodView | null> {
    const [row] = await this.sql<Row[]>`
      select ${this.sql.unsafe(COLUMNS)} from public.accounting_period
      where tenant_id = ${this.tenantId}
        and year = extract(year from ${date}::date) and month = extract(month from ${date}::date)
      for share`;
    return row ? toView(row) : null;
  }

  async insert(year: number, month: number): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.accounting_period (tenant_id, year, month)
      values (${this.tenantId}, ${year}, ${month})
      returning id`;
    return row!.id;
  }

  async exists(year: number, month: number): Promise<boolean> {
    const [row] = await this.sql<{ exists: boolean }[]>`
      select exists (
        select 1 from public.accounting_period
        where tenant_id = ${this.tenantId} and year = ${year} and month = ${month}
      ) as exists`;
    return row!.exists;
  }

  async close(id: string, expectedVersion: number, userId: string): Promise<void> {
    const rows = await this.sql`
      update public.accounting_period
      set status = 'closed', closed_at = now(), closed_by = ${userId}
      where tenant_id = ${this.tenantId} and id = ${id} and version = ${expectedVersion}
        and status = 'open'
      returning id`;
    if (rows.length === 0) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
  }

  async reopen(id: string, expectedVersion: number, userId: string, reason: string): Promise<void> {
    const rows = await this.sql`
      update public.accounting_period
      set status = 'open', closed_at = null, closed_by = null, reopened_at = now(),
          reopened_by = ${userId}, reopen_reason = ${reason}
      where tenant_id = ${this.tenantId} and id = ${id} and version = ${expectedVersion}
        and status = 'closed'
      returning id`;
    if (rows.length === 0) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
  }

  /** Approved vouchers dated in the month that are not posted yet (the close warning, FR-065). */
  async unpostedApproved(year: number, month: number): Promise<UnpostedVoucherView[]> {
    const [table] = await this.sql<{ exists: boolean }[]>`
      select to_regclass('public.voucher') is not null as exists`;
    if (!table?.exists) return [];
    const rows = await this.sql<
      {
        id: string;
        type: string;
        number: string | null;
        voucher_date: string;
        amount: string;
        currency: string;
      }[]
    >`
      select id, type, number, voucher_date::text, amount::text, currency::text
      from public.voucher
      where tenant_id = ${this.tenantId} and status in ('checked', 'approved')
        and extract(year from voucher_date) = ${year} and extract(month from voucher_date) = ${month}
      order by voucher_date, number`;
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      number: r.number,
      voucherDate: r.voucher_date,
      amount: r.amount,
      currency: r.currency,
    }));
  }
}
