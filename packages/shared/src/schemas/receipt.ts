// Goods received notes and completion certificates (002 US7, US8; contracts/rest-api.md
// "Receipt"; research R24). Bodies are `.strict()`: the supplier and PO number of a GRN are
// inherited from the PO, and a certificate's amount is computed, so neither is accepted.
import { z } from 'zod';
import type { ReceiptStatus } from '../doc-types';
import { expectedVersion, isoDate, listQuery, reason, uuid } from './common';
import { quantityString } from './pr';
import { percentString } from './procurement-config';

export const SHIPMENT_TYPES = ['partial', 'final'] as const;
export type ShipmentType = (typeof SHIPMENT_TYPES)[number];

const positiveQty = (q: string) => Number(q) > 0;

export const grnLineInput = z
  .object({
    poLineId: uuid,
    deliveredQty: quantityString,
    acceptedQty: quantityString,
    rejectedQty: quantityString.default('0'),
    rejectReason: z.string().trim().max(1000).optional(),
    conditionRemarks: z.string().trim().max(1000).optional(),
    isAsset: z.boolean().default(false),
  })
  .strict()
  .refine((l) => positiveQty(l.deliveredQty), {
    message: 'The delivered quantity must be greater than zero',
    path: ['deliveredQty'],
  })
  .refine(
    (l) =>
      Math.round((Number(l.acceptedQty) + Number(l.rejectedQty)) * 1000) ===
      Math.round(Number(l.deliveredQty) * 1000),
    { message: 'Accepted + rejected must equal delivered', path: ['acceptedQty'] }
  )
  .refine((l) => !positiveQty(l.rejectedQty) || !!l.rejectReason, {
    message: 'A rejected quantity needs a reason',
    path: ['rejectReason'],
  });
export type GrnLineInput = z.input<typeof grnLineInput>;

/** POST /pos/:id/grns */
export const createGrnBody = z
  .object({
    receivedDate: isoDate,
    deliveryNoteNo: z.string().trim().min(1).max(100),
    supplierInvoiceNo: z.string().trim().max(100).optional(),
    shipmentType: z.enum(SHIPMENT_TYPES),
    lines: z.array(grnLineInput).min(1).max(500),
  })
  .strict()
  .refine((g) => new Set(g.lines.map((l) => l.poLineId)).size === g.lines.length, {
    message: 'Each PO line appears once',
    path: ['lines'],
  });
export type CreateGrnInput = z.input<typeof createGrnBody>;

export const RECEIPT_SIGN_ROLES = ['received', 'inspected'] as const;
export type ReceiptSignRole = (typeof RECEIPT_SIGN_ROLES)[number];

/** POST /grns/:id/sign — completion when both signatures exist (FR-041). */
export const grnSignBody = z
  .object({ expectedVersion, role: z.enum(RECEIPT_SIGN_ROLES) })
  .strict();
export type GrnSignInput = z.input<typeof grnSignBody>;

/** POST /grns/:id/lines/:lineId/return */
export const grnReturnBody = z.object({ returnedOn: isoDate }).strict();
export type GrnReturnInput = z.input<typeof grnReturnBody>;

/** POST /grns/:id/cancel — a draft only. */
export const grnCancelBody = z.object({ expectedVersion, reason }).strict();
export type GrnCancelInput = z.input<typeof grnCancelBody>;

export const grnLineParams = z.object({ id: uuid, lineId: uuid });

export const grnListQuery = listQuery.extend({
  status: z.enum(['draft', 'completed', 'cancelled']).optional(),
  poId: uuid.optional(),
});
export type GrnListQuery = z.infer<typeof grnListQuery>;

// --- completion certificates (US8) -----------------------------------------------------------

/** POST /pos/:id/completion-certificates */
export const createCertificateBody = z
  .object({
    milestoneId: uuid.optional(),
    poLineId: uuid.optional(),
    completionPct: percentString.refine((v) => Number(v) > 0, 'Must be greater than zero'),
    periodText: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((c) => !!c.milestoneId !== !!c.poLineId, {
    message: 'Name a milestone or a PO line',
    path: ['milestoneId'],
  });
export type CreateCertificateInput = z.input<typeof createCertificateBody>;

export const certificateSignBody = z
  .object({ expectedVersion, role: z.enum(['certified', 'confirmed']) })
  .strict();
export type CertificateSignInput = z.input<typeof certificateSignBody>;

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export interface GrnSummary {
  id: string;
  number: string;
  status: ReceiptStatus;
  poId: string;
  poNumber: string | null;
  supplierId: string;
  supplierNameAr: string;
  supplierNameEn: string;
  receivedDate: string;
  shipmentType: ShipmentType;
  createdAt: string;
}

export interface GrnLineView {
  id: string;
  poLineId: string;
  lineNo: number;
  description: string | null;
  orderedQty: string;
  deliveredQty: string;
  acceptedQty: string;
  rejectedQty: string;
  rejectReason: string | null;
  returnedOn: string | null;
  conditionRemarks: string | null;
  isAsset: boolean;
}

export interface GrnSignatureView {
  role: ReceiptSignRole;
  userId: string;
  userName: string;
  actedAt: string;
}

export interface GrnDetail extends GrnSummary {
  version: number;
  officeId: string;
  createdBy: string;
  deliveryNoteNo: string | null;
  supplierInvoiceNo: string | null;
  completedAt: string | null;
  cancelReason: string | null;
  lines: GrnLineView[];
  signatures: GrnSignatureView[];
  /** sign_received, sign_inspected, return, cancel */
  availableActions: string[];
}
