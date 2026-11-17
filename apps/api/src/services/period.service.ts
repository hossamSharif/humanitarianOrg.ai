// Accounting periods (002 US12, FR-065; research R33). Closing a month lists the approved
// vouchers dated in it that are not posted yet and needs `confirm: true` after that warning;
// reopening needs periods:manage and a reason (422 REASON_REQUIRED), kept on the period and in
// the audit history. Posting asks `assertOpen` for the voucher date's period under FOR SHARE, so
// a close running at the same time waits (PERIOD_CLOSED once it is closed).
import {
  PERMISSIONS_002,
  type AccountingPeriodView,
  type ClosePeriodInput,
  type ClosePeriodResult,
  type CreatePeriodInput,
  type ReopenPeriodInput,
} from '@ngo/shared';
import { withTenantTx, type TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import { AccountingPeriodRepository } from '../repositories/accounting-period.repository';
import type { RequestContext } from '../types/context';
import { ensureTenantSeeds } from './doc-adapters/binding';

export interface PeriodServiceDeps {
  run<T>(
    ctx: RequestContext,
    fn: (repos: { tx: TenantTx; periods: AccountingPeriodRepository }) => Promise<T>
  ): Promise<T>;
}

export const defaultPeriodDeps: PeriodServiceDeps = {
  run: (ctx, fn) =>
    withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, async (tx) => {
      await ensureTenantSeeds(tx);
      return fn({ tx, periods: new AccountingPeriodRepository(tx.sql, ctx.tenantId) });
    }),
};

function assertManage(ctx: RequestContext): void {
  if (!ctx.permissions.has(PERMISSIONS_002.PERIODS_MANAGE)) {
    throw new AppError('FORBIDDEN', `Missing permission ${PERMISSIONS_002.PERIODS_MANAGE}`);
  }
}

/**
 * The period of `date` must exist and be open (posting); read FOR SHARE inside the posting
 * transaction. 409 PERIOD_CLOSED with the year and month otherwise.
 */
export async function assertPeriodOpen(
  periods: AccountingPeriodRepository,
  date: string
): Promise<AccountingPeriodView> {
  const period = await periods.forDate(date);
  const [year, month] = date.split('-').map(Number) as [number, number];
  if (!period || period.status !== 'open') {
    throw new AppError(
      'PERIOD_CLOSED',
      period ? 'The accounting period is closed' : 'The accounting period does not exist',
      { year, month }
    );
  }
  return period;
}

export class PeriodService {
  constructor(private readonly deps: PeriodServiceDeps = defaultPeriodDeps) {}

  list(ctx: RequestContext): Promise<AccountingPeriodView[]> {
    return this.deps.run(ctx, ({ periods }) => periods.list());
  }

  create(ctx: RequestContext, input: CreatePeriodInput): Promise<AccountingPeriodView> {
    assertManage(ctx);
    return this.deps.run(ctx, async ({ periods }) => {
      if (await periods.exists(input.year, input.month)) {
        throw new AppError('VALIDATION_ERROR', 'This period already exists', [
          { field: 'month', message: 'already_exists' },
        ]);
      }
      return periods.get(await periods.insert(input.year, input.month));
    });
  }

  /** First call without `confirm` warns about unposted approved vouchers (FR-065). */
  close(ctx: RequestContext, id: string, input: ClosePeriodInput): Promise<ClosePeriodResult> {
    assertManage(ctx);
    return this.deps.run(ctx, async ({ periods }) => {
      const period = await periods.get(id, { lock: true });
      if (period.version !== input.expectedVersion) {
        throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
      }
      if (period.status !== 'open')
        throw new AppError('INVALID_STATE', 'The period is already closed');
      const unposted = await periods.unpostedApproved(period.year, period.month);
      if (unposted.length > 0 && !input.confirm) {
        return { requiresConfirmation: true, unpostedApproved: unposted };
      }
      await periods.close(id, input.expectedVersion, ctx.userId);
      return { requiresConfirmation: false, period: await periods.get(id) };
    });
  }

  /** Reopening needs a reason, stored on the period and as the audit comment (US12-4). */
  reopen(ctx: RequestContext, id: string, input: ReopenPeriodInput): Promise<AccountingPeriodView> {
    assertManage(ctx);
    const reason = input.reason?.trim();
    if (!reason) throw new AppError('REASON_REQUIRED', 'Give the reason for reopening the period');
    return this.deps.run(ctx, async ({ tx, periods }) => {
      const period = await periods.get(id, { lock: true });
      if (period.version !== input.expectedVersion) {
        throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
      }
      if (period.status !== 'closed') throw new AppError('INVALID_STATE', 'The period is open');
      await tx.setAuditComment(reason);
      await periods.reopen(id, input.expectedVersion, ctx.userId, reason);
      return periods.get(id);
    });
  }
}
