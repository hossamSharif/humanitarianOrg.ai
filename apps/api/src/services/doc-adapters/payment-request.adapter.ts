// The payment request against an order as a PAY document (research D1, R25; US11). The DoA
// amount is the net in the DoA reference currency at the submission date. Submission locks the PO
// row, so parallel requests on one PO serialize, and refuses a request that would take the live
// requests above the PO total including amendments (PO_OVERPAID, FR-060) or whose match failed
// without an override (MATCH_FAILED, FR-056). Neither the preparer (preparer_approves_payment) nor
// a signer of the matched receipts (receiver_approves_payment) signs its steps. Order requests
// have no budget effect until the voucher is posted (clarification Q3). A suspended or closed
// grant, or a supplier blacklisted since the order, needs the Finance Manager override.
import {
  PERMISSIONS,
  PERMISSIONS_002,
  calendarDateInTimeZone,
  convert,
  parseAmount,
  type ResolvedRate,
} from '@ngo/shared';
import type { TenantTx } from '../../db/tx';
import { AppError } from '../../middleware/error';
import type { PaymentRequestRecord } from '../../repositories/payment-request.repository';
import type { RequestContext } from '../../types/context';
import { PAYMENT_EDITABLE, paymentRepos } from '../payment-request.service';
import type { DocAdapter, DocRef } from './types';

export interface PaymentSubmitState {
  doaCurrency: string;
  doaRate: ResolvedRate;
}

const CANCELLABLE = new Set(['draft', 'returned', 'pending_approval', 'approved']);

export function paymentRequestAdapter(
  tx: TenantTx,
  ctx: RequestContext
): DocAdapter<PaymentRequestRecord, PaymentSubmitState> {
  const repos = paymentRepos(tx, ctx);
  const { requests } = repos;

  const ref = (r: PaymentRequestRecord, number: string | null = r.number): DocRef => ({
    id: r.id,
    requesterId: r.createdBy,
    requestingOfficeId: r.officeId,
    number,
  });

  return {
    docType: 'PAY',
    doaType: 'PAY',
    reassignPermissions: [PERMISSIONS.SETTINGS_MANAGE],
    frozenGrantOverride: true,

    load: (id, { lock }) => requests.find(id, { lock }),
    creatorId: (r) => r.createdBy,
    officeId: (r) => r.officeId,

    /** Signers of the matched receipts may not sign the payment (receiver_approves_payment). */
    async segregationFacts(r) {
      const rows = await tx.sql<{ user_id: string }[]>`
        select distinct s.user_id from public.doc_signature s
        where s.tenant_id = ${ctx.tenantId}
          and ((s.doc_type = 'GRN' and s.doc_id = any (${tx.sql.array(r.grnIds)}::uuid[])
                and s.action in ('received', 'inspected'))
            or (s.doc_type = 'SCC' and s.doc_id = any (${tx.sql.array(r.certificateIds)}::uuid[])
                and s.action in ('certified', 'confirmed')))`;
      return { receiptSignerIds: rows.map((x) => x.user_id) };
    },

    assertMaySubmit(r, actor) {
      if (!actor.permissions.has(PERMISSIONS_002.PAYMENT_CREATE)) {
        throw new AppError('FORBIDDEN', `Missing permission ${PERMISSIONS_002.PAYMENT_CREATE}`);
      }
      if (!PAYMENT_EDITABLE.has(r.status)) {
        throw new AppError(
          'INVALID_STATE',
          'Only a draft or returned payment request is submitted'
        );
      }
    },
    isPending: (status) => status === 'pending_approval',
    pendingStatus: () => 'pending_approval',
    cancellable: (status) => CANCELLABLE.has(status),
    mayCancel: (_r, actor) => actor.permissions.has(PERMISSIONS_002.PAYMENT_CREATE),

    async prepareSubmit(r) {
      if (r.poId) {
        // the PO row lock serializes parallel submissions on one order (FR-060)
        const po = await repos.pos.get(r.poId, { lock: true });
        if (r.kind === 'order') {
          const others = await requests.requestedOnPo(r.poId, r.id);
          const requested = parseAmount(others).plus(parseAmount(r.poAmount));
          const total = parseAmount(po.totalWithAmendments);
          if (requested.gt(total)) {
            throw new AppError('PO_OVERPAID', 'The payment requests exceed the order total', {
              total: total.toFixed(2),
              requested: requested.toFixed(2),
              remaining: total.minus(parseAmount(others)).toFixed(2),
            });
          }
        }
      }
      if (r.matchStatus === 'mismatch') {
        const lines = await repos.requestLines.list(r.id);
        const tolerance = await tx.sql<{ qty: string; price: string }[]>`
          select invoice_qty_tolerance_pct::text as qty, invoice_price_tolerance_pct::text as price
          from public.procurement_setting where tenant_id = ${ctx.tenantId}`;
        throw new AppError(
          'MATCH_FAILED',
          'The invoice does not match the order and the receipts',
          {
            lines: lines
              .filter((l) => l.matchResult && l.matchResult !== 'ok')
              .map((l) => ({
                lineId: l.id,
                result: l.matchResult!,
                invoicedQty: l.invoicedQty ?? '0',
                acceptedQty: l.acceptedQty ?? '0',
                invoicedPrice: l.unitPrice ?? '0',
                poPrice: l.poPrice ?? '0',
                tolerancePct:
                  l.matchResult === 'qty_exceeds'
                    ? (tolerance[0]?.qty ?? '0')
                    : (tolerance[0]?.price ?? '0'),
              })),
          }
        );
      }
      if ((await repos.requestLines.list(r.id)).length === 0) {
        throw new AppError('VALIDATION_ERROR', 'The payment request has no lines');
      }

      const facts = await repos.events.tenantFacts();
      const submittedAt = new Date();
      const date = calendarDateInTimeZone(submittedAt, facts.timeZone);
      const rates = await repos.rates.resolveRates(tx, [r.currency, facts.doaCurrency], date);
      const doaRate = rates.get(facts.doaCurrency)!;
      return {
        officeId: r.officeId,
        doaAmount: convert(r.net, rates.get(r.currency)!.rateToBase, doaRate.rateToBase),
        timeZone: facts.timeZone,
        submittedAt,
        state: { doaCurrency: facts.doaCurrency, doaRate },
      };
    },

    async onSubmit() {},

    markSubmitted: (r, plan, info) =>
      requests.markSubmitted(r.id, {
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

    grantFrozen: async (r) => r.grantStatus !== 'active' || r.supplierStatus === 'blacklisted',

    /** No budget effect (Q3); the invoice is matched by the approved request. */
    async onApproved(r) {
      if (r.invoiceId) await repos.invoices.setStatus(r.invoiceId, 'matched');
    },

    async onReleased() {},

    async setStatus(r, change) {
      switch (change.kind) {
        case 'advanced':
          return requests.updateWorkflow(r.id, {
            status: change.status,
            currentStepOrder: change.currentStepOrder,
          });
        case 'approved':
          return requests.updateWorkflow(r.id, {
            status: 'approved',
            approvedAt: change.at,
            currentStepOrder: null,
          });
        case 'rejected':
          return requests.updateWorkflow(r.id, {
            status: 'rejected',
            currentStepOrder: null,
            rejectReason: change.reason,
          });
        case 'returned':
          return requests.updateWorkflow(r.id, {
            status: 'returned',
            currentStepOrder: null,
            returnReason: change.reason,
          });
        case 'cancelled':
          return requests.updateWorkflow(r.id, {
            status: 'cancelled',
            currentStepOrder: null,
            cancelReason: change.reason,
            cancelledAt: change.at,
          });
        case 'touched':
          return requests.updateWorkflow(r.id, {});
      }
    },

    ref: (r, number) => ref(r, number === undefined ? r.number : number),
  };
}
