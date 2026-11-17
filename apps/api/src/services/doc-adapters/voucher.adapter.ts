// Vouchers as BPV / CPV / BRV / CRV / JV / TRF documents (research D1, D5; US13). The route is the
// type's DoA route (PV / RV / JV), whose first step is `check`: submitting numbers the voucher by
// its type and office and makes it `pending_check`; signing the check step makes it `checked`
// and the final step `approved` — posting is voucher.service's. The DoA amount is Σ base debit
// in the DoA reference currency. Entered by, checked by and approved by are three people
// (voucher_three_people, also a DB trigger); every signature needs a balanced voucher
// (VOUCHER_UNBALANCED with the totals, US13-2). A voucher of a suspended or closed grant is not
// approved (FR-096). Vouchers hold no budget themselves: Actual and consumption come at posting.
import {
  DOC_TYPE_DOA,
  PERMISSIONS,
  PERMISSIONS_002,
  baseTotals,
  calendarDateInTimeZone,
  convert,
  isBalanced,
  type DoaType,
  type ResolvedRate,
  type VoucherType,
} from '@ngo/shared';
import type { TenantTx } from '../../db/tx';
import { AppError } from '../../middleware/error';
import type { VoucherRecord } from '../../repositories/voucher.repository';
import type { RequestContext } from '../../types/context';
import { VOUCHER_EDITABLE, voucherRepos } from '../voucher.service';
import type { DocAdapter, DocRef } from './types';

export interface VoucherSubmitState {
  doaCurrency: string;
  doaRate: ResolvedRate;
}

const PENDING = new Set(['pending_check', 'checked']);
const CANCELLABLE = new Set(['draft', 'returned', 'pending_check', 'checked', 'approved']);

export function voucherAdapter(
  tx: TenantTx,
  ctx: RequestContext,
  docType: VoucherType
): DocAdapter<VoucherRecord, VoucherSubmitState> {
  const repos = voucherRepos(tx, ctx);
  const { vouchers, voucherLines } = repos;

  const ref = (v: VoucherRecord, number: string | null = v.number): DocRef => ({
    id: v.id,
    requesterId: v.enteredBy,
    requestingOfficeId: v.officeId,
    number,
  });

  async function assertBalanced(id: string): Promise<void> {
    const lines = await voucherLines.list(id);
    if (!isBalanced(lines)) {
      const totals = baseTotals(lines);
      throw new AppError(
        'VOUCHER_UNBALANCED',
        'The voucher does not balance in the base currency',
        {
          baseDebit: totals.baseDebit,
          baseCredit: totals.baseCredit,
          difference: totals.difference,
        }
      );
    }
  }

  return {
    docType,
    doaType: DOC_TYPE_DOA[docType] as DoaType,
    reassignPermissions: [PERMISSIONS.SETTINGS_MANAGE],
    segregationMessages: {
      voucher_three_people: 'A voucher is entered, checked and approved by three different people',
    },

    load: async (id, { lock }) => {
      const v = await vouchers.find(id, { lock });
      return v && v.type === docType ? v : null;
    },
    creatorId: (v) => v.enteredBy,
    officeId: (v) => v.officeId,

    assertMaySubmit(v, actor) {
      if (!actor.permissions.has(PERMISSIONS_002.VOUCHER_CREATE)) {
        throw new AppError('FORBIDDEN', `Missing permission ${PERMISSIONS_002.VOUCHER_CREATE}`);
      }
      if (!VOUCHER_EDITABLE.has(v.status)) {
        throw new AppError('INVALID_STATE', 'Only a draft or returned voucher is submitted');
      }
    },
    isPending: (status) => PENDING.has(status),
    pendingStatus: (step) => (step.kind === 'check' ? 'pending_check' : 'checked'),
    cancellable: (status) => CANCELLABLE.has(status),
    mayCancel: (_v, actor) => actor.permissions.has(PERMISSIONS_002.VOUCHER_CREATE),

    async prepareSubmit(v) {
      await assertBalanced(v.id);
      const lines = await voucherLines.list(v.id);
      const facts = await repos.events.tenantFacts();
      const submittedAt = new Date();
      const date = calendarDateInTimeZone(submittedAt, facts.timeZone);
      const rates = await repos.rates.resolveRates(tx, [facts.doaCurrency], date);
      const doaRate = rates.get(facts.doaCurrency)!;
      return {
        officeId: v.officeId,
        doaAmount: convert(baseTotals(lines).baseDebit, '1', doaRate.rateToBase),
        timeZone: facts.timeZone,
        submittedAt,
        state: { doaCurrency: facts.doaCurrency, doaRate },
      };
    },

    async onSubmit() {},

    markSubmitted: (v, plan, info) =>
      vouchers.markSubmitted(v.id, {
        number: info.number,
        status: info.firstStepStatus,
        submissionCycle: info.cycle,
        currentStepOrder: info.firstStepOrder,
        submittedAt: plan.submittedAt.toISOString(),
        doaCurrency: plan.state.doaCurrency,
        doaAmount: plan.doaAmount,
        doaRateToBase: plan.state.doaRate.rateToBase,
        doaRateDate: plan.state.doaRate.rateDate,
        doaRateSource: plan.state.doaRate.source,
        doaExchangeRateId: plan.state.doaRate.exchangeRateId,
      }),

    /** The check (and every later step) needs a balanced voucher (FR-069). */
    beforeSign: (v) => assertBalanced(v.id),
    grantFrozen: async (v) => v.grantId !== null && v.grantStatus !== 'active',

    async onApproved() {},
    async onReleased() {},

    async setStatus(v, change) {
      switch (change.kind) {
        case 'advanced':
          return vouchers.updateWorkflow(v.id, {
            status: change.status,
            currentStepOrder: change.currentStepOrder,
          });
        case 'approved':
          return vouchers.updateWorkflow(v.id, {
            status: 'approved',
            approvedAt: change.at,
            currentStepOrder: null,
          });
        // a voucher has no `rejected` state: a rejection cancels it with the reason
        case 'rejected':
          return vouchers.updateWorkflow(v.id, {
            status: 'cancelled',
            currentStepOrder: null,
            rejectReason: change.reason,
            cancelReason: change.reason,
            cancelledAt: change.at,
          });
        case 'returned':
          return vouchers.updateWorkflow(v.id, {
            status: 'returned',
            currentStepOrder: null,
            returnReason: change.reason,
          });
        case 'cancelled':
          return vouchers.updateWorkflow(v.id, {
            status: 'cancelled',
            currentStepOrder: null,
            cancelReason: change.reason,
            cancelledAt: change.at,
          });
        case 'touched':
          return vouchers.updateWorkflow(v.id, {});
      }
    },

    ref: (v, number) => ref(v, number === undefined ? v.number : number),
  };
}
