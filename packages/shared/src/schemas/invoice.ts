// Supplier invoices (002 US11, contracts/rest-api.md "Invoices and payment requests"; research
// R25). Bodies are `.strict()`: the supplier is the PO's and the amount is Σ lines, so neither
// is accepted.
import { z } from 'zod';
import { currencyCode, isoDate, listQuery, moneyString, uuid } from './common';
import { quantityString } from './pr';

export const SUPPLIER_INVOICE_STATUSES = ['registered', 'matched', 'cancelled'] as const;
export type SupplierInvoiceStatus = (typeof SUPPLIER_INVOICE_STATUSES)[number];

export const invoiceLineInput = z
  .object({ poLineId: uuid, quantity: quantityString, unitPrice: moneyString })
  .strict();
export type InvoiceLineInput = z.input<typeof invoiceLineInput>;

/** POST /pos/:id/invoices → 409 DUPLICATE_INVOICE for the same supplier invoice number. */
export const createInvoiceBody = z
  .object({
    supplierInvoiceNo: z.string().trim().min(1).max(100),
    invoiceDate: isoDate,
    currency: currencyCode,
    lines: z.array(invoiceLineInput).min(1).max(500),
    /** the scanned invoice: an uploaded attachment of the PO */
    attachmentId: uuid.optional(),
  })
  .strict()
  .refine((i) => new Set(i.lines.map((l) => l.poLineId)).size === i.lines.length, {
    message: 'Each PO line appears once',
    path: ['lines'],
  });
export type CreateInvoiceInput = z.input<typeof createInvoiceBody>;

export const invoiceListQuery = listQuery.extend({
  status: z.enum(SUPPLIER_INVOICE_STATUSES).optional(),
  poId: uuid.optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuery>;

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export interface SupplierInvoiceSummary {
  id: string;
  number: string;
  status: SupplierInvoiceStatus;
  poId: string;
  poNumber: string | null;
  supplierId: string;
  supplierNameAr: string;
  supplierNameEn: string;
  supplierInvoiceNo: string;
  invoiceDate: string;
  currency: string;
  amount: string;
  createdAt: string;
}

export interface SupplierInvoiceLineView {
  id: string;
  poLineId: string;
  lineNo: number;
  description: string | null;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  orderedQty: string;
  poPrice: string;
  acceptedQty: string;
}

export interface SupplierInvoiceDetail extends SupplierInvoiceSummary {
  version: number;
  officeId: string;
  attachmentId: string | null;
  lines: SupplierInvoiceLineView[];
  /** the live payment request that uses it, if any */
  paymentRequest: { id: string; number: string | null; status: string } | null;
  /** create_payment_request */
  availableActions: string[];
}
