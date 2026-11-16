// Purchase requisition bodies and responses (contracts/rest-api.md "Purchase requisitions").
// A draft is saved incomplete (autosave), so the draft schemas accept missing fields; the
// complete `prHeader` / `prLine` shapes are what submission requires and what the web form
// checks before submitting. Amounts are decimal strings; dates ISO YYYY-MM-DD.
import { z } from 'zod';
import type { Money } from '../money';
import type { PrAction, PrStatus } from '../pr-state';
import type { StepKind } from '../permissions';
import { currencyCode, expectedVersion, isoDate, moneyString, uuid } from './common';

export const PR_TYPES = ['goods', 'services', 'mixed'] as const;
export const prType = z.enum(PR_TYPES);
export type PrType = z.infer<typeof prType>;

/** Quantity > 0 with at most 3 decimals: '10', '2.5', '0.125'. */
export const quantityString = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,3})?$/, 'Must be a quantity with at most 3 decimals')
  .refine((v) => /[1-9]/.test(v), 'Must be greater than zero');

const text = (max: number) => z.string().trim().max(max);

// ---------------------------------------------------------------------------------------------
// Header and lines
// ---------------------------------------------------------------------------------------------

const headerFields = {
  prDate: isoDate,
  requestingOfficeId: uuid,
  grantId: uuid,
  deliverToOfficeId: uuid,
  deliveryAddress: text(500).nullish(),
  contactName: text(200).nullish(),
  contactPhone: text(50).nullish(),
  requiredByDate: isoDate.nullish(),
  activityId: uuid.nullish(),
  purpose: text(4000).nullish(),
  prType,
};

/** Complete header, as submission requires it. */
export const prHeader = z.object(headerFields);

/** Draft header: every field may still be missing. */
export const prDraftHeader = z.object({
  prDate: isoDate.nullish(),
  requestingOfficeId: uuid.nullish(),
  grantId: uuid.nullish(),
  deliverToOfficeId: uuid.nullish(),
  deliveryAddress: headerFields.deliveryAddress,
  contactName: headerFields.contactName,
  contactPhone: headerFields.contactPhone,
  requiredByDate: headerFields.requiredByDate,
  activityId: headerFields.activityId,
  purpose: headerFields.purpose,
  prType: prType.nullish(),
});

const lineFields = {
  description: z.string().trim().min(1).max(2000),
  specifications: text(8000).nullish(),
  quantity: quantityString,
  unitId: uuid,
  unitCost: moneyString,
  currency: currencyCode,
  budgetLineId: uuid,
  locationOfficeId: uuid,
  activityId: uuid.nullish(),
};

/** Complete line, as submission requires it. */
export const prLine = z.object(lineFields);

/** Draft line; `id` identifies a stored line so a save updates it instead of replacing it. */
export const prDraftLine = z.object({
  id: uuid.optional(),
  description: text(2000).nullish(),
  specifications: lineFields.specifications,
  quantity: quantityString.nullish(),
  unitId: uuid.nullish(),
  unitCost: moneyString.nullish(),
  currency: currencyCode.nullish(),
  budgetLineId: uuid.nullish(),
  locationOfficeId: uuid.nullish(),
  activityId: lineFields.activityId,
});

export const MAX_PR_LINES = 200;

/** POST /prs */
export const prCreate = z.object({
  header: prDraftHeader.optional(),
  lines: z.array(prDraftLine).max(MAX_PR_LINES).optional(),
});

/** PATCH /prs/:id — the full draft document (autosave). */
export const prDraftUpdate = z.object({
  expectedVersion,
  header: prDraftHeader,
  lines: z.array(prDraftLine).max(MAX_PR_LINES),
});

/** POST /prs/:id/submit */
export const prSubmit = z.object({ expectedVersion });

export type PrHeader = z.infer<typeof prHeader>;
export type PrDraftHeader = z.infer<typeof prDraftHeader>;
export type PrLine = z.infer<typeof prLine>;
export type PrDraftLine = z.infer<typeof prDraftLine>;
export type PrCreate = z.infer<typeof prCreate>;
export type PrDraftUpdate = z.infer<typeof prDraftUpdate>;
export type PrSubmit = z.infer<typeof prSubmit>;

// ---------------------------------------------------------------------------------------------
// Attachments (research R11)
// ---------------------------------------------------------------------------------------------

export const ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
] as const;
export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_PR = 20;

/** POST /prs/:id/attachments/upload-url */
export const attachmentUpload = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(ATTACHMENT_MIME_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
});

export type AttachmentUpload = z.infer<typeof attachmentUpload>;

export const prAttachmentParams = z.object({ id: uuid, attId: uuid });

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export interface PrLineView {
  id: string;
  lineNo: number;
  description: string | null;
  specifications: string | null;
  quantity: string | null;
  unitId: string | null;
  unitCost: string | null;
  /** quantity × unit cost, rounded to 2 decimals; null until both are entered */
  lineTotal: string | null;
  currency: string;
  budgetLineId: string | null;
  locationOfficeId: string | null;
  activityId: string | null;
  /** locked at submission (FR-028); null while draft */
  rateToBase: string | null;
  rateDate: string | null;
  rateSource: string | null;
  exchangeRateId: string | null;
  amountGrant: string | null;
}

export interface PrAttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string | null;
}

export type PrStepStatus =
  'waiting' | 'pending' | 'approved' | 'rejected' | 'returned' | 'cancelled';

export interface PrStepView {
  id: string;
  cycle: number;
  stepOrder: number;
  kind: StepKind;
  requiredRoleId: string;
  roleNameAr: string;
  roleNameEn: string;
  assignedUserId: string | null;
  status: PrStepStatus;
  actedAt: string | null;
  /** the caller's eligibility on this step (pending steps only) */
  canApprove: boolean;
  canReject: boolean;
  canReturn: boolean;
  canChangeBudgetLine: boolean;
}

/** An approval_action row: signatures (`approve`) and every other recorded action. */
export interface PrActionView {
  id: string;
  cycle: number;
  stepOrder: number | null;
  action: string;
  userId: string;
  userName: string;
  userPosition: string | null;
  comment: string | null;
  actedAt: string;
}

export interface PrReservation {
  budgetLineId: string;
  cycle: number;
  amount: string;
  currency: string;
  status: 'reserved' | 'committed' | 'released';
}

export interface PrDetail {
  id: string;
  number: string | null;
  status: PrStatus;
  version: number;
  prDate: string | null;
  requestingOfficeId: string | null;
  grantId: string | null;
  deliverToOfficeId: string | null;
  deliveryAddress: string | null;
  contactName: string | null;
  contactPhone: string | null;
  requiredByDate: string | null;
  activityId: string | null;
  purpose: string | null;
  prType: PrType | null;
  requesterId: string;
  requesterName: string | null;
  requesterPosition: string | null;
  submissionCycle: number;
  currentStepOrder: number | null;
  doaCurrency: string | null;
  doaAmount: string | null;
  doaRateToBase: string | null;
  doaRateDate: string | null;
  doaRateSource: string | null;
  grantCurrency: string | null;
  grantRateToBase: string | null;
  grantRateDate: string | null;
  grantRateSource: string | null;
  totalGrantCurrency: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  returnReason: string | null;
  rejectReason: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  lines: PrLineView[];
  /** one total per line currency */
  totals: Money[];
  attachments: PrAttachmentView[];
  /** steps of the current submission cycle */
  steps: PrStepView[];
  actions: PrActionView[];
  reservations: PrReservation[];
  /** actions the caller may take now */
  availableActions: PrAction[];
}

/** POST /prs → 201 */
export interface PrCreated {
  id: string;
  version: number;
  status: 'draft';
}

/** PATCH /prs/:id — stored line ids in document order, so new lines get their ids. */
export interface PrDraftSaved {
  id: string;
  version: number;
  status: PrStatus;
  lineIds: string[];
  /** false when the body matched the stored draft (no write, no version bump) */
  changed: boolean;
}

export interface PrSubmitResult {
  id: string;
  status: PrStatus;
  number: string;
  version: number;
  steps: { stepOrder: number; kind: StepKind; status: PrStepStatus }[];
  reservations: { budgetLineId: string; amount: string; currency: string }[];
}

export interface AttachmentUploadTarget {
  attachmentId: string;
  /** Supabase Storage signed upload URL (PUT the file body) */
  signedUrl: string;
  path: string;
  token: string;
}
