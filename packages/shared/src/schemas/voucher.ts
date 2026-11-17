// Vouchers (002 US13, US14; contracts/rest-api.md "Accounting"; research D5). Rates are looked
// up by the API on the voucher date and never sent: the manual line shape has no rate, no base
// amount and no Actual, and every body is `.strict()`.
import { z } from 'zod';
import type { DocStepView } from './doc-actions';
import type { VoucherStatus, VoucherType } from '../doc-types';
import { VOUCHER_TYPES } from '../doc-types';
import {
  currencyCode,
  expectedVersion,
  isoDate,
  listQuery,
  moneyString,
  reason,
  uuid,
} from './common';

export const RECEIPT_KINDS = [
  'donor_tranche',
  'supplier_refund',
  'advance_return',
  'other_income',
  'bid_security',
] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];

/** POST /payment-requests/:id/voucher — the draft is generated; date and cheque are the only input. */
export const generateVoucherBody = z
  .object({
    voucherDate: isoDate.optional(),
    chequeNo: z.string().trim().min(1).max(50).optional(),
  })
  .strict();
export type GenerateVoucherInput = z.input<typeof generateVoucherBody>;

/** POST /vouchers/:id/check — the `check` step (balance enforced). */
export const voucherCheckBody = z
  .object({ expectedVersion, stepId: uuid, comment: z.string().trim().max(2000).optional() })
  .strict();
export type VoucherCheckInput = z.input<typeof voucherCheckBody>;

/** POST /vouchers/:id/post — received-by for cash and cheques (FR-074). */
export const voucherPostBody = z
  .object({
    expectedVersion,
    receivedByName: z.string().trim().min(1).max(300).optional(),
    receivedOn: isoDate.optional(),
    receivedCopyAttachmentId: uuid.optional(),
  })
  .strict();
export type VoucherPostInput = z.input<typeof voucherPostBody>;

/** POST /vouchers/:id/reverse → a mirrored draft at the original rates. */
export const voucherReverseBody = z
  .object({ expectedVersion, reason, reversalDate: isoDate })
  .strict();
export type VoucherReverseInput = z.input<typeof voucherReverseBody>;

/** A manual voucher line (US14): never a rate, a base amount or an Actual. */
export const manualVoucherLineInput = z
  .object({
    accountId: uuid,
    description: z.string().trim().max(500).optional(),
    currency: currencyCode,
    debit: moneyString.default('0'),
    credit: moneyString.default('0'),
    grantId: uuid.optional(),
    budgetLineId: uuid.optional(),
    locationOfficeId: uuid.optional(),
    activityId: uuid.optional(),
    donorId: uuid.optional(),
    categoryText: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((l) => Number(l.debit) > 0 !== Number(l.credit) > 0, {
    message: 'Enter either a debit or a credit',
    path: ['debit'],
  });
export type ManualVoucherLineInput = z.input<typeof manualVoucherLineInput>;

export const voucherListQuery = listQuery.extend({
  type: z.enum(VOUCHER_TYPES).optional(),
  status: z
    .enum(['draft', 'pending_check', 'checked', 'approved', 'posted', 'returned', 'cancelled'])
    .optional(),
  paymentRequestId: uuid.optional(),
});
export type VoucherListQuery = z.infer<typeof voucherListQuery>;

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export interface VoucherSummary {
  id: string;
  type: VoucherType;
  number: string | null;
  status: VoucherStatus;
  voucherDate: string;
  payeeName: string | null;
  currency: string;
  amount: string;
  moneyAccountName: string | null;
  paymentRequestId: string | null;
  reversalOfId: string | null;
  reversedById: string | null;
  createdAt: string;
}

export interface VoucherLineView {
  id: string;
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountNameAr: string;
  accountNameEn: string;
  description: string | null;
  currency: string;
  debit: string;
  credit: string;
  rateToBase: string;
  rateDate: string;
  baseDebit: string;
  baseCredit: string;
  grantId: string | null;
  budgetLineId: string | null;
  budgetLineCode: string | null;
  locationOfficeId: string | null;
  activityId: string | null;
  donorId: string | null;
  donorName: string | null;
  categoryText: string | null;
  actualGrantAmount: string | null;
  commitmentConsumedGrant: string | null;
  postedPeriod: string | null;
}

export interface VoucherDetail extends VoucherSummary {
  version: number;
  officeId: string;
  enteredBy: string;
  moneyAccountId: string | null;
  paymentMethod: string | null;
  chequeNo: string | null;
  reason: string | null;
  amountInWordsAr: string | null;
  amountInWordsEn: string | null;
  grantId: string | null;
  postedAt: string | null;
  postedBy: string | null;
  receivedByName: string | null;
  receivedOn: string | null;
  receivedCopyAttachmentId: string | null;
  reversedAt: string | null;
  submissionCycle: number;
  currentStepOrder: number | null;
  returnReason: string | null;
  cancelReason: string | null;
  totals: { baseDebit: string; baseCredit: string; difference: string; baseCurrency: string };
  /** CPV, or BPV paid by cheque: received-by name, date and signed copy before posting */
  requiresReceivedBy: boolean;
  lines: VoucherLineView[];
  steps: DocStepView[];
  /** submit, check, post, reverse plus the shared step actions */
  availableActions: string[];
}
