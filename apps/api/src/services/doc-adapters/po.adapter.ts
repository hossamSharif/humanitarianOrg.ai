// The purchase order / contract as a PO or CON document (research D2, R23; US6). The DoA amount
// is the PO total in the DoA reference currency at the submission date; the creator cannot
// approve (creator_approves). Final approval converts the commitment under locks: the ordered PR
// lines' PR rows are released `converted_to_po` (a remainder row keeps any unordered part), the
// PO rows are inserted `committed` at the rate of the PO currency on the approval date (locked),
// and the net increase must fit in Available (BUDGET_EXCEEDED with the shortfall). The PR lines
// become ordered and a PR whose lines are all ordered or cancelled closes (FR-038).
import {
  Decimal,
  PERMISSIONS,
  PERMISSIONS_002,
  calendarDateInTimeZone,
  convert,
  parseAmount,
  type ResolvedRate,
} from '@ngo/shared';
import type { TenantTx } from '../../db/tx';
import { AppError } from '../../middleware/error';
import type { PurchaseOrderRecord } from '../../repositories/purchase-order.repository';
import type { RequestContext } from '../../types/context';
import { PO_OPEN_STATUSES, poRepos } from '../purchase-order.service';
import type { DocAdapter, DocRef } from './types';

export interface PoSubmitState {
  doaCurrency: string;
  doaRate: ResolvedRate;
}

const CANCELLABLE = new Set(['draft', 'returned', 'pending_approval', 'approved', 'acknowledged']);

export function poAdapter(
  tx: TenantTx,
  ctx: RequestContext,
  docType: 'PO' | 'CON' = 'PO'
): DocAdapter<PurchaseOrderRecord, PoSubmitState> {
  const repos = poRepos(tx, ctx);
  const { pos, lines } = repos;

  const ref = (po: PurchaseOrderRecord, number: string | null = po.number): DocRef => ({
    id: po.id,
    requesterId: po.createdBy,
    requestingOfficeId: po.officeId,
    number,
  });

  /** PR lines → ordered (or back to not sourced), their sourcing lines closed, PRs refreshed. */
  async function settlePrLines(poId: string, status: 'ordered' | 'not_sourced'): Promise<void> {
    const rows = await tx.sql<{ pr_line_id: string; sourcing_line_id: string; pr_id: string }[]>`
      select o.pr_line_id, o.sourcing_line_id, l.pr_id
      from public.po_line o join public.pr_line l on l.id = o.pr_line_id
      where o.tenant_id = ${ctx.tenantId} and o.po_id = ${poId}`;
    if (rows.length === 0) return;
    await repos.events.setPrLineStatus(
      rows.map((r) => r.pr_line_id),
      status
    );
    await tx.sql`
      update public.sourcing_line set is_open = false
      where tenant_id = ${ctx.tenantId}
        and id = any (${tx.sql.array(rows.map((r) => r.sourcing_line_id))}::uuid[])`;
    const prIds = [...new Set(rows.map((r) => r.pr_id))];
    await repos.events.refreshPrStatuses(prIds);
    // FR-038: every line ordered or cancelled → the PR closes
    await tx.sql`
      update public.purchase_requisition p
      set status = 'closed', closed_at = now()
      where p.tenant_id = ${ctx.tenantId} and p.id = any (${tx.sql.array(prIds)}::uuid[])
        and p.status = 'in_procurement'
        and not exists (select 1 from public.pr_line l where l.pr_id = p.id
                        and l.sourcing_status not in ('ordered', 'cancelled'))`;
  }

  return {
    docType,
    doaType: docType,
    reassignPermissions: [PERMISSIONS.SETTINGS_MANAGE],

    load: (id, { lock }) => pos.find(id, { lock }),
    creatorId: (po) => po.createdBy,
    officeId: (po) => po.officeId,

    assertMaySubmit(po, actor) {
      if (!actor.permissions.has(PERMISSIONS_002.PO_CREATE)) {
        throw new AppError('FORBIDDEN', `Missing permission ${PERMISSIONS_002.PO_CREATE}`);
      }
      if (po.status !== 'draft' && po.status !== 'returned') {
        throw new AppError('INVALID_STATE', 'Only a draft or returned purchase order is submitted');
      }
    },
    isPending: (status) => status === 'pending_approval',
    pendingStatus: () => 'pending_approval',
    cancellable: (status) => CANCELLABLE.has(status),
    mayCancel: (_po, actor) =>
      actor.permissions.has(PERMISSIONS_002.PO_CANCEL) ||
      actor.permissions.has(PERMISSIONS_002.PO_CREATE),

    async prepareSubmit(po) {
      if ((await lines.list(po.id)).length === 0) {
        throw new AppError('VALIDATION_ERROR', 'The purchase order has no lines');
      }
      const facts = await repos.events.tenantFacts();
      const submittedAt = new Date();
      const date = calendarDateInTimeZone(submittedAt, facts.timeZone);
      const rates = await repos.rates.resolveRates(tx, [po.currency, facts.doaCurrency], date);
      const doaRate = rates.get(facts.doaCurrency)!;
      const doaAmount = convert(
        po.totalWithAmendments,
        rates.get(po.currency)!.rateToBase,
        doaRate.rateToBase
      );
      return {
        officeId: po.officeId,
        doaAmount,
        timeZone: facts.timeZone,
        submittedAt,
        state: { doaCurrency: facts.doaCurrency, doaRate },
      };
    },

    async onSubmit() {},

    markSubmitted: (po, plan, info) =>
      pos.markSubmitted(po.id, {
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

    grantFrozen: async (po) => (await pos.grantStatus(po.id)) !== 'active',

    /** D2 conversion: PR rows → converted_to_po, PO rows committed at the locked rate. */
    async onApproved(po) {
      const facts = await repos.events.tenantFacts();
      const rates = await repos.rates.resolveRates(tx, [po.currency, po.grantCurrency], facts.today);
      const poRate = rates.get(po.currency)!;
      const grantRate = rates.get(po.grantCurrency)!;
      const rateToGrant = parseAmount(poRate.rateToBase)
        .dividedBy(parseAmount(grantRate.rateToBase))
        .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
        .toFixed(6);

      // budget lines locked in ascending id order (001 R4)
      const amounts = await lines.byBudgetLine(po.id);
      await tx.sql`
        select id from public.budget_line
        where id = any (${tx.sql.array(amounts.map((a) => a.budgetLineId))}::uuid[])
        order by id for update`;

      for (const pr of await lines.prCommitments(po.id)) {
        let left = parseAmount(pr.amountGrant);
        const open = (await repos.sources.list(tx, { docType: 'PR', docId: pr.prId })).filter(
          (c) => c.status !== 'released' && c.budgetLineId === pr.budgetLineId
        );
        for (const row of open) {
          if (left.lte(0)) break;
          const take = Decimal.min(left, parseAmount(row.amount));
          await repos.budget.splitConsume(tx, row.id, take.toFixed(2), 'converted_to_po');
          left = left.minus(take);
        }
      }

      await lines.setAmountGrant(po.id, rateToGrant);
      const perLine = new Map<string, Decimal>();
      for (const l of await lines.list(po.id)) {
        perLine.set(
          l.budgetLineId,
          (perLine.get(l.budgetLineId) ?? new Decimal(0)).plus(parseAmount(l.amountGrant ?? '0'))
        );
      }
      await repos.budget.commitDirect(
        tx,
        { docType: po.docType, docId: po.id },
        Math.max(po.submissionCycle, 1),
        [...perLine].map(([budgetLineId, amount]) => ({ budgetLineId, amount: amount.toFixed(2) })),
        {
          rateToGrant,
          rateDate: poRate.rateDate,
          rateSource: poRate.source,
          exchangeRateId: poRate.exchangeRateId,
        }
      );
      await pos.setCommitRate(po.id, {
        rateToBase: poRate.rateToBase,
        rateDate: poRate.rateDate,
        rateSource: poRate.source,
        exchangeRateId: poRate.exchangeRateId,
        grantRateToBase: grantRate.rateToBase,
      });
      await settlePrLines(po.id, 'ordered');
    },

    /** Cancelling an approved PO releases its rows; its PR lines go back to not sourced (D2). */
    async onReleased(po, reason) {
      if (reason === 'cancelled' && PO_OPEN_STATUSES.has(po.status)) {
        await repos.budget.releaseFor(tx, { docType: po.docType, docId: po.id }, 'cancelled');
        await settlePrLines(po.id, 'not_sourced');
      }
    },

    async setStatus(po, change) {
      switch (change.kind) {
        case 'advanced':
          return pos.updateWorkflow(po.id, {
            status: change.status,
            currentStepOrder: change.currentStepOrder,
          });
        case 'approved': {
          const version = await pos.updateWorkflow(po.id, {
            status: 'approved',
            approvedAt: change.at,
            currentStepOrder: null,
          });
          await repos.versions.snapshot(po.id, 1);
          return version;
        }
        case 'rejected':
          return pos.updateWorkflow(po.id, {
            status: 'rejected',
            currentStepOrder: null,
            rejectReason: change.reason,
          });
        case 'returned':
          return pos.updateWorkflow(po.id, {
            status: 'returned',
            currentStepOrder: null,
            returnReason: change.reason,
          });
        case 'cancelled':
          return pos.updateWorkflow(po.id, {
            status: 'cancelled',
            currentStepOrder: null,
            cancelReason: change.reason,
            cancelledAt: change.at,
          });
        case 'touched':
          return pos.updateWorkflow(po.id, {});
      }
    },

    ref: (po, number) => ref(po, number === undefined ? po.number : number),
  };
}
