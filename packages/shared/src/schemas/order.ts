// Purchase orders and contracts (002 US6, contracts/rest-api.md "POs, contracts, amendments";
// research D2, R23). Bodies are `.strict()`: supplier, lines, prices, grant, budget lines,
// locations, activities, currency and totals are inherited from the award or computed, so a
// client that sends them is refused (US6-2).
import { z } from 'zod';
import type { PurchaseOrderStatus } from '../doc-types';
import type { DocStepView } from './doc-actions';
import { expectedVersion, isoDate, listQuery, reason, uuid } from './common';
import { percentString } from './procurement-config';

export const PO_KINDS = ['po', 'contract'] as const;
export type PoKind = (typeof PO_KINDS)[number];

/** POST /bid-analyses/:id/pos — one draft per awarded supplier; `kind` defaults from the PR type. */
export const createPosBody = z.object({ kind: z.enum(PO_KINDS).optional() }).strict();
export type CreatePosInput = z.input<typeof createPosBody>;

export const poListQuery = listQuery.extend({
  status: z
    .enum([
      'draft',
      'pending_approval',
      'approved',
      'acknowledged',
      'partially_received',
      'fully_received',
      'closed',
      'returned',
      'rejected',
      'cancelled',
    ])
    .optional(),
  kind: z.enum(PO_KINDS).optional(),
  bidAnalysisId: uuid.optional(),
  /** only POs a GRN can be recorded against now */
  receivable: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type PoListQuery = z.infer<typeof poListQuery>;

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/** PATCH /pos/:id — the non-inherited fields, while the PO is a draft or returned. */
export const poPatchBody = z
  .object({
    expectedVersion,
    poDate: isoDate.nullable().optional(),
    deliveryAddress: optionalText(1000),
    deliverySchedule: optionalText(1000),
    deliveryTerms: optionalText(2000),
    paymentTermsText: optionalText(2000),
    specialConditions: optionalText(4000),
    advancePct: percentString.optional(),
    retentionPct: percentString.optional(),
    retentionReleaseDate: isoDate.nullable().optional(),
    isService: z.boolean().optional(),
    // contract fields (US8)
    scopeText: optionalText(8000),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
  })
  .strict()
  .refine((p) => !p.startDate || !p.endDate || p.endDate >= p.startDate, {
    message: 'The end date cannot be before the start date',
    path: ['endDate'],
  });
export type PoPatchInput = z.input<typeof poPatchBody>;

/** POST /pos/:id/acknowledge — the signed copy, uploaded first as a `po_acknowledgement` attachment. */
export const poAcknowledgeBody = z
  .object({
    expectedVersion,
    acknowledgedAt: isoDate,
    acknowledgedByName: z.string().trim().min(1).max(200),
    attachmentId: uuid,
  })
  .strict();
export type PoAcknowledgeInput = z.input<typeof poAcknowledgeBody>;

/** POST /pos/:id/close — manual close with a reason; the remaining commitment is released. */
export const poCloseBody = z.object({ expectedVersion, reason }).strict();
export type PoCloseInput = z.input<typeof poCloseBody>;

const ratingScore = z.number().int().min(1).max(5);

/** POST /pos/:id/rating — once per PO, after it is fully received (FR-013). */
export const poRatingBody = z
  .object({
    onTime: ratingScore,
    quality: ratingScore,
    documentation: ratingScore,
    comment: z.string().trim().max(2000).optional(),
  })
  .strict();
export type PoRatingInput = z.input<typeof poRatingBody>;

/** POST /prs/:id/lines/:lineId/cancel — an unsourced line of an approved PR (FR-038). */
export const prLineCancelBody = z.object({ expectedVersion, reason }).strict();
export type PrLineCancelInput = z.input<typeof prLineCancelBody>;

export const poVersionParams = z.object({ id: uuid, v: z.coerce.number().int().min(1) });

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export interface PurchaseOrderSummary {
  id: string;
  kind: PoKind;
  docType: 'PO' | 'CON';
  number: string | null;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierNameAr: string;
  supplierNameEn: string;
  bidAnalysisId: string | null;
  analysisNumber: string | null;
  currency: string;
  totalWithAmendments: string;
  poDate: string | null;
  createdAt: string;
}

export interface PoLineView {
  id: string;
  lineNo: number;
  awardLineId: string | null;
  sourcingLineId: string | null;
  prLineId: string | null;
  prId: string | null;
  prNumber: string | null;
  description: string | null;
  quantity: string;
  unitId: string | null;
  unitNameAr: string | null;
  unitNameEn: string | null;
  unitPrice: string;
  lineTotal: string;
  budgetLineId: string;
  budgetLineCode: string;
  locationOfficeId: string | null;
  activityId: string | null;
  amountGrant: string | null;
  acceptedQty: string;
  /** ordered − accepted (never below 0) */
  remainingQty: string;
  invoicedQty: string;
  paidAmount: string;
}

/** One budget line's commitment before and after approval, in the grant currency. */
export interface PoBudgetEffect {
  budgetLineId: string;
  code: string;
  currency: string;
  /** what the ordered PR lines committed */
  prCommitted: string;
  /** the PO amount converted at the commit rate (or today's rate before approval) */
  poAmount: string;
  /** poAmount − prCommitted: > 0 must fit in Available */
  difference: string;
  available: string;
}

export interface PurchaseOrderDetail extends PurchaseOrderSummary {
  version: number;
  officeId: string;
  createdBy: string;
  grantId: string;
  grantCode: string;
  grantCurrency: string;
  eventNumber: string | null;
  poDate: string | null;
  deliveryAddress: string | null;
  deliverySchedule: string | null;
  deliveryTerms: string | null;
  paymentTermsText: string | null;
  specialConditions: string | null;
  advancePct: string;
  retentionPct: string;
  retentionReleaseDate: string | null;
  isService: boolean;
  total: string;
  totalInWordsAr: string | null;
  totalInWordsEn: string | null;
  poVersion: number;
  commitRateToBase: string | null;
  commitRateDate: string | null;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  acknowledgementAttachmentId: string | null;
  requireAcknowledgement: boolean;
  closeReason: string | null;
  closedAt: string | null;
  cancelReason: string | null;
  returnReason: string | null;
  rejectReason: string | null;
  scopeText: string | null;
  startDate: string | null;
  endDate: string | null;
  doaCurrency: string | null;
  doaAmount: string | null;
  blacklistFlag: boolean;
  supplierStatus: string;
  lines: PoLineView[];
  budgetEffect: PoBudgetEffect[];
  grns: { id: string; number: string; status: string; receivedDate: string }[];
  rating: { onTime: number; quality: number; documentation: number; comment: string | null } | null;
  steps: DocStepView[];
  availableActions: string[];
}

export interface PoVersionView {
  version: number;
  createdAt: string;
  createdByAmendmentId: string | null;
  snapshot: Record<string, unknown>;
}
