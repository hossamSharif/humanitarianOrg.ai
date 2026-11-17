// Supplier invoices (002 US11, FR-054; research R25). An invoice is registered against an
// approved, open PO and inherits its supplier; it is numbered INV on registration and refused as
// DUPLICATE_INVOICE when the supplier already has a live invoice with the same number, ignoring
// case and surrounding spaces (US11-5). Its lines name lines of the PO; the match against the
// receipts happens when a payment request is built from it (payment-request.service.ts).
import {
  PERMISSIONS_002,
  type CreateInvoiceInput,
  type InvoiceListQuery,
  type ListResponse,
  type SupplierInvoiceDetail,
  type SupplierInvoiceSummary,
} from '@ngo/shared';
import { withTenantTx, type TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import { NumberingRepository } from '../repositories/numbering.repository';
import { PaymentRequestRepository } from '../repositories/payment-request.repository';
import {
  SupplierInvoiceRepository,
  type SupplierInvoiceRecord,
} from '../repositories/supplier-invoice.repository';
import type { RequestContext } from '../types/context';
import { ensureTenantSeeds } from './doc-adapters/binding';
import { NumberingService, numberingTxStore } from './numbering.service';
import { PO_OPEN_STATUSES, poRepos, type PoRepos } from './purchase-order.service';

export interface InvoiceRepos extends PoRepos {
  invoices: SupplierInvoiceRepository;
  requests: PaymentRequestRepository;
  numbering: NumberingService;
}

export interface InvoiceServiceDeps {
  run<T>(ctx: RequestContext, fn: (repos: InvoiceRepos) => Promise<T>): Promise<T>;
}

export function invoiceRepos(tx: TenantTx, ctx: RequestContext): InvoiceRepos {
  const t = ctx.tenantId;
  return {
    ...poRepos(tx, ctx),
    invoices: new SupplierInvoiceRepository(tx.sql, t),
    requests: new PaymentRequestRepository(tx.sql, t),
    numbering: new NumberingService(new NumberingRepository(ctx), numberingTxStore(t)),
  };
}

export const defaultInvoiceDeps: InvoiceServiceDeps = {
  run: (ctx, fn) =>
    withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, async (tx) => {
      await ensureTenantSeeds(tx);
      return fn(invoiceRepos(tx, ctx));
    }),
};

export class InvoiceService {
  constructor(private readonly deps: InvoiceServiceDeps = defaultInvoiceDeps) {}

  list(
    ctx: RequestContext,
    query: InvoiceListQuery
  ): Promise<ListResponse<SupplierInvoiceSummary>> {
    return this.deps.run(ctx, ({ invoices }) =>
      invoices.list({
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        poId: query.poId,
      })
    );
  }

  get(ctx: RequestContext, id: string): Promise<SupplierInvoiceDetail> {
    return this.deps.run(ctx, (repos) => this.detail(repos, id));
  }

  async detail(repos: InvoiceRepos, id: string): Promise<SupplierInvoiceDetail> {
    const invoice = await repos.invoices.get(id);
    const [lines, request] = await Promise.all([
      repos.invoices.lines(id),
      repos.requests.forInvoice(id),
    ]);
    return {
      ...invoice,
      lines,
      paymentRequest: request,
      availableActions: this.actionsFor(repos.ctx, invoice, request !== null),
    };
  }

  private actionsFor(
    ctx: RequestContext,
    invoice: SupplierInvoiceRecord,
    requested: boolean
  ): string[] {
    const actions: string[] = [];
    if (
      invoice.status === 'registered' &&
      !requested &&
      ctx.permissions.has(PERMISSIONS_002.PAYMENT_CREATE)
    ) {
      actions.push('create_payment_request');
    }
    return actions;
  }

  /** POST /pos/:id/invoices — numbered now; supplier inherited from the PO. */
  register(
    ctx: RequestContext,
    poId: string,
    input: CreateInvoiceInput
  ): Promise<SupplierInvoiceDetail> {
    if (!ctx.permissions.has(PERMISSIONS_002.INVOICE_REGISTER)) {
      throw new AppError('FORBIDDEN', `Missing permission ${PERMISSIONS_002.INVOICE_REGISTER}`);
    }
    return this.deps.run(ctx, async (repos) => {
      const po = await repos.pos.get(poId, { lock: true });
      if (!PO_OPEN_STATUSES.has(po.status)) {
        throw new AppError(
          'INVALID_STATE',
          'Invoices are registered against an approved, open order'
        );
      }
      if (input.currency !== po.currency) {
        throw new AppError('VALIDATION_ERROR', 'The invoice is in the currency of its order', [
          { field: 'currency', message: 'must_equal_po_currency' },
        ]);
      }
      const poLines = await repos.lines.list(poId);
      for (const l of input.lines) {
        if (!poLines.some((p) => p.id === l.poLineId)) {
          throw new AppError(
            'INHERITED_FIELD_MISMATCH',
            'An invoice line belongs to a line of this order',
            {
              poLineId: l.poLineId,
            }
          );
        }
      }

      const duplicate = await repos.invoices.findDuplicate(po.supplierId, input.supplierInvoiceNo);
      if (duplicate) {
        throw new AppError(
          'DUPLICATE_INVOICE',
          'This supplier invoice number is already registered',
          {
            supplierInvoiceNo: input.supplierInvoiceNo,
            existingNumber: duplicate,
          }
        );
      }

      if (input.attachmentId) {
        const [attachment] = await repos.tx.sql<{ id: string }[]>`
          select id from public.doc_attachment
          where tenant_id = ${ctx.tenantId} and id = ${input.attachmentId}
            and doc_type = ${po.docType} and doc_id = ${poId} and deleted_at is null
            and uploaded_at is not null`;
        if (!attachment) {
          throw new AppError(
            'VALIDATION_ERROR',
            'The invoice scan is not an attachment of the order',
            [{ field: 'attachmentId', message: 'not_found' }]
          );
        }
      }

      const facts = await repos.events.tenantFacts();
      const number = await repos.numbering.assignNumber(
        repos.tx.sql,
        'INV',
        po.officeId,
        new Date(),
        facts.timeZone
      );
      const id = await repos.invoices.insert({
        number,
        poId,
        officeId: po.officeId,
        supplierId: po.supplierId,
        supplierInvoiceNo: input.supplierInvoiceNo,
        invoiceDate: input.invoiceDate,
        currency: input.currency,
        attachmentId: input.attachmentId ?? null,
      });
      await repos.invoices.insertLines(id, input.lines);
      return this.detail(repos, id);
    });
  }
}
