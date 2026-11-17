// Sourcing: RFQs (and, with US9, tenders) from approved PR lines (002 US3, US4,
// contracts/rest-api.md "RFQs and tenders"). One model for both kinds (research R21): lines
// from PR lines of one grant and office, criteria per stage, invitations, the receipt log, the
// opening and the sealed terms and prices. Bodies are `.strict()`, so computed fields (the
// required method, estimated value, quantities copied from the PR, receipt status) are never
// accepted.
import { z } from 'zod';
import type { SourcingEventStatus } from '../doc-types';
import {
  PROCUREMENT_METHODS,
  type MethodBand,
  type ProcurementMethod,
} from '../procurement/method';
import { currencyCode, expectedVersion, isoDate, listQuery, reason, uuid } from './common';
import type { SupplierCompliance, SupplierStatus } from './supplier';

export const SOURCING_KINDS = ['rfq', 'tender'] as const;
export type SourcingKind = (typeof SOURCING_KINDS)[number];

export const INVITATION_CHANNELS = [
  'email',
  'whatsapp',
  'in_person',
  'newspaper',
  'website',
  'notice_board',
] as const;
export type InvitationChannel = (typeof INVITATION_CHANNELS)[number];

export const CRITERION_STAGES = ['single', 'technical', 'financial'] as const;
export type CriterionStage = (typeof CRITERION_STAGES)[number];

export const CRITERION_KINDS = ['essential', 'weighted'] as const;
export type CriterionKind = (typeof CRITERION_KINDS)[number];

export const OFFER_STATUSES = [
  'logged',
  'replaced',
  'late',
  'late_accepted',
  'withdrawn',
  'disqualified',
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** Default criteria of a new RFQ (single stage, Σ = 100); editable while draft. */
export const DEFAULT_RFQ_CRITERIA: readonly SourcingCriterionInput[] = [
  {
    stage: 'single',
    kind: 'weighted',
    code: 'price',
    nameAr: 'السعر',
    nameEn: 'Price',
    weightPct: '50',
    isPrice: true,
  },
  {
    stage: 'single',
    kind: 'weighted',
    code: 'quality',
    nameAr: 'الجودة والمواصفات',
    nameEn: 'Quality and specifications',
    weightPct: '20',
    isPrice: false,
  },
  {
    stage: 'single',
    kind: 'weighted',
    code: 'delivery',
    nameAr: 'مدة التسليم',
    nameEn: 'Delivery time',
    weightPct: '15',
    isPrice: false,
  },
  {
    stage: 'single',
    kind: 'weighted',
    code: 'validity',
    nameAr: 'صلاحية العرض',
    nameEn: 'Offer validity',
    weightPct: '15',
    isPrice: false,
  },
];

const text = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v));

/** Percentage with at most 2 decimals, 0 < w ≤ 100. */
export const weightString = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Must be a percentage with at most 2 decimals')
  .refine((v) => Number(v) > 0 && Number(v) <= 100, 'Must be greater than 0 and at most 100');

/** ISO date-time with an offset or Z, e.g. 2026-11-20T10:00:00+02:00. */
export const isoDateTime = z.string().datetime({ offset: true });

// ---------------------------------------------------------------------------------------------
// Requests (US3)
// ---------------------------------------------------------------------------------------------

/** GET /sourcing/pr-lines — approved, not-sourced PR lines. */
export const sourceablePrLinesQuery = z
  .object({
    grantId: uuid.optional(),
    officeId: uuid.optional(),
    q: z.string().trim().max(200).optional(),
  })
  .strict();
export type SourceablePrLinesQuery = z.infer<typeof sourceablePrLinesQuery>;

export const rfqListQuery = listQuery.extend({
  status: z
    .enum(['draft', 'issued', 'closed', 'opened', 'evaluated', 'awarded', 'cancelled'])
    .optional(),
  grantId: uuid.optional(),
  q: z.string().trim().max(200).optional(),
});
export type RfqListQuery = z.infer<typeof rfqListQuery>;

const headerFields = {
  title: z.string().trim().min(1).max(300),
  issueDate: z.union([isoDate, z.null()]).optional(),
  submissionDeadline: z.union([isoDateTime, z.null()]).optional(),
  deliveryPlace: text(500),
  deliveryTerms: text(2000),
  paymentTerms: text(2000),
  currency: currencyCode.optional(),
  offerValidityDays: z.union([z.number().int().min(1).max(3650), z.null()]).optional(),
  splitAwardAllowed: z.boolean().optional(),
};

/** POST /rfqs */
export const createRfqBody = z
  .object({
    prLineIds: z.array(uuid).min(1).max(200),
    ...headerFields,
  })
  .strict();
export type CreateRfqInput = z.input<typeof createRfqBody>;

export const sourcingCriterionInput = z
  .object({
    stage: z.enum(CRITERION_STAGES).default('single'),
    kind: z.enum(CRITERION_KINDS),
    code: z.string().regex(/^[a-z0-9_]{1,40}$/),
    nameAr: z.string().trim().min(1).max(200),
    nameEn: z.string().trim().min(1).max(200),
    weightPct: z.union([weightString, z.null()]).optional(),
    isPrice: z.boolean().default(false),
  })
  .strict()
  .refine((c) => (c.kind === 'weighted') === (c.weightPct != null), {
    message: 'Weighted criteria carry a weight; essential criteria do not',
    path: ['weightPct'],
  })
  .refine((c) => !c.isPrice || c.kind === 'weighted', {
    message: 'The price criterion is weighted',
    path: ['isPrice'],
  });
export type SourcingCriterionInput = z.input<typeof sourcingCriterionInput>;

export const sourcingInvitationInput = z
  .object({
    supplierId: uuid,
    channel: z.enum(INVITATION_CHANNELS),
    invitedOn: isoDate.optional(),
  })
  .strict();
export type SourcingInvitationInput = z.input<typeof sourcingInvitationInput>;

/** Rewording only (FR-015): quantity and unit stay the PR line's. */
export const sourcingLineEdit = z
  .object({
    id: uuid,
    description: text(2000),
    specifications: text(4000),
  })
  .strict();

/** PATCH /rfqs/:id (draft): header, line wording, criteria and invitations (full replace). */
export const updateRfqBody = z
  .object({
    expectedVersion,
    ...headerFields,
    title: headerFields.title.optional(),
    chosenMethod: z.enum(PROCUREMENT_METHODS).optional(),
    waiverId: z.union([uuid, z.null()]).optional(),
    lines: z.array(sourcingLineEdit).max(200).optional(),
    criteria: z.array(sourcingCriterionInput).max(30).optional(),
    invitations: z.array(sourcingInvitationInput).max(100).optional(),
  })
  .strict();
export type UpdateRfqInput = z.input<typeof updateRfqBody>;

/** POST /rfqs/:id/issue */
export const issueRfqBody = z
  .object({
    expectedVersion,
    splittingAcknowledgement: z
      .object({ comment: z.string().trim().min(1).max(2000) })
      .strict()
      .optional(),
  })
  .strict();
export type IssueRfqInput = z.input<typeof issueRfqBody>;

/** POST /rfqs/:id/cancel and /reissue */
export const sourcingReasonBody = z.object({ expectedVersion, reason }).strict();
export type SourcingReasonInput = z.input<typeof sourcingReasonBody>;

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export interface SourceablePrLine {
  id: string;
  prId: string;
  prNumber: string | null;
  prDate: string;
  grantId: string;
  grantCode: string;
  officeId: string;
  lineNo: number;
  description: string | null;
  specifications: string | null;
  quantity: string;
  unitId: string | null;
  unitCode: string | null;
  unitCost: string;
  lineTotal: string;
  currency: string;
  budgetLineId: string | null;
  budgetLineCode: string | null;
}

export interface SplittingWarning {
  prIds: string[];
  /** combined estimated value in the DoA reference currency */
  total: string;
  bandMax: string;
}

export interface SourcingLineView {
  id: string;
  lineNo: number;
  prLineId: string;
  prId: string;
  prNumber: string | null;
  description: string | null;
  specifications: string | null;
  quantity: string;
  unitId: string | null;
  unitCode: string | null;
  lotId: string | null;
  /** the PR line's estimate (never an offer price) */
  estimatedTotal: string;
  estimatedCurrency: string;
}

export interface SourcingCriterionView {
  id: string;
  sortOrder: number;
  stage: CriterionStage;
  kind: CriterionKind;
  code: string;
  nameAr: string;
  nameEn: string;
  weightPct: string | null;
  isPrice: boolean;
}

export interface SourcingInvitationView {
  id: string;
  supplierId: string;
  supplierNameAr: string;
  supplierNameEn: string;
  supplierStatus: SupplierStatus;
  compliance: SupplierCompliance;
  invitedOn: string;
  channel: InvitationChannel;
}

/** The receipt log: always readable, never a price (research D3). */
export interface OfferReceiptView {
  id: string;
  supplierId: string;
  supplierNameAr: string;
  supplierNameEn: string;
  receivedAt: string;
  receivedById: string;
  receivedByName: string;
  status: OfferStatus;
  replacesId: string | null;
  lateAcceptanceReason: string | null;
  disqualificationReason: string | null;
  /** terms were entered (after the opening) */
  hasTerms: boolean;
}

export interface OpeningView {
  openedAt: string;
  place: string | null;
  notes: string | null;
  attendees: { userId: string | null; name: string; function: string }[];
  signedCompleteAt: string | null;
}

export interface MethodProposal {
  requiredMethod: ProcurementMethod;
  requiredMinQuotations: number;
  chosenMethod: ProcurementMethod;
  estimatedValue: string;
  currency: string;
  bandsUsed: { tenant: MethodBand; grant: MethodBand | null };
}

export interface SourcingEventSummary {
  id: string;
  kind: SourcingKind;
  number: string | null;
  status: SourcingEventStatus;
  title: string;
  grantId: string;
  grantCode: string;
  officeId: string;
  issueDate: string | null;
  submissionDeadline: string | null;
  requiredMethod: ProcurementMethod;
  chosenMethod: ProcurementMethod;
  estimatedValueDoa: string;
  doaCurrency: string;
  lineCount: number;
  invitationCount: number;
  offerCount: number;
  createdAt: string;
}

export type SourcingAction =
  | 'edit'
  | 'issue'
  | 'cancel'
  | 'reissue'
  | 'log_receipt'
  | 'open'
  | 'enter_terms'
  | 'create_analysis';

export interface SourcingEventDetail extends SourcingEventSummary {
  deliveryPlace: string | null;
  deliveryTerms: string | null;
  paymentTerms: string | null;
  currency: string;
  offerValidityDays: number | null;
  splitAwardAllowed: boolean;
  method: MethodProposal;
  splittingWarning: SplittingWarning | null;
  splittingAcknowledged: boolean;
  waiverId: string | null;
  openedAt: string | null;
  /** the database clock passed the deadline (opening allowed) */
  deadlinePassed: boolean;
  reissuedFromId: string | null;
  reissuedToId: string | null;
  cancelReason: string | null;
  createdBy: string;
  version: number;
  lines: SourcingLineView[];
  criteria: SourcingCriterionView[];
  invitations: SourcingInvitationView[];
  offers: OfferReceiptView[];
  opening: OpeningView | null;
  analysisId: string | null;
  availableActions: SourcingAction[];
}

// ---------------------------------------------------------------------------------------------
// RFQ print (one addressee supplier, US20-2): no offers, no other supplier, no price. The schema
// is strict at every level, so a price or offer key cannot slip into the print data.
// ---------------------------------------------------------------------------------------------

export const rfqPrintData = z
  .object({
    docType: z.literal('RFQ'),
    locale: z.enum(['ar', 'en']),
    number: z.string().nullable(),
    status: z.string(),
    watermark: z.enum(['DRAFT', 'CANCELLED']).nullable(),
    organization: z
      .object({
        nameAr: z.string(),
        nameEn: z.string(),
        address: z.string().nullable(),
        logoUrl: z.string().nullable(),
      })
      .strict(),
    office: z.object({ code: z.string(), nameAr: z.string(), nameEn: z.string() }).strict(),
    supplier: z
      .object({
        nameAr: z.string(),
        nameEn: z.string(),
        address: z.string().nullable(),
        phone: z.string().nullable(),
        email: z.string().nullable(),
      })
      .strict(),
    title: z.string(),
    issueDate: z.string().nullable(),
    submissionDeadline: z.string().nullable(),
    deliveryPlace: z.string().nullable(),
    deliveryTerms: z.string().nullable(),
    paymentTerms: z.string().nullable(),
    currency: z.string(),
    offerValidityDays: z.number().nullable(),
    lines: z.array(
      z
        .object({
          lineNo: z.number(),
          description: z.string().nullable(),
          specifications: z.string().nullable(),
          quantity: z.string(),
          unit: z.string().nullable(),
        })
        .strict()
    ),
    criteria: z.array(
      z
        .object({
          name: z.string(),
          kind: z.enum(CRITERION_KINDS),
          weightPct: z.string().nullable(),
        })
        .strict()
    ),
  })
  .strict();
export type RfqPrintData = z.infer<typeof rfqPrintData>;

export const rfqPrintQuery = z
  .object({ supplierId: uuid, locale: z.enum(['ar', 'en']).default('en') })
  .strict();
export type RfqPrintQuery = z.infer<typeof rfqPrintQuery>;
