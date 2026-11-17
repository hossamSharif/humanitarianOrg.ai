// Payment requests (002 US11, US15; contracts/rest-api.md "Invoices and payment requests";
// research R25, R26). Every amount — gross, advance, retention, deductions, net, the words and
// the charge-to table — is computed by the API (FR-058), so the bodies are `.strict()` and carry
// none of them: a client sending `gross` or `net` gets 400.
import { z } from 'zod';
import type { DocStepView } from './doc-actions';
import type { PaymentRequestStatus } from '../doc-types';
import type { MatchResult } from '../procurement/match';
import { currencyCode, expectedVersion, listQuery, moneyString, reason, uuid } from './common';

export const PAYMENT_REQUEST_KINDS = [
  'order',
  'retention',
  'direct',
  'bid_security_return',
] as const;
export type PaymentRequestKind = (typeof PAYMENT_REQUEST_KINDS)[number];

export const PAYMENT_METHODS = ['bank_transfer', 'cheque', 'bank_draft', 'cash'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYEE_TYPES = ['supplier', 'staff', 'other'] as const;
export type PayeeType = (typeof PAYEE_TYPES)[number];

export const MATCH_STATUSES = ['matched', 'mismatch', 'overridden', 'n_a'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** POST /pos/:id/payment-requests — the amounts and the match come back computed. */
export const createOrderPaymentBody = z
  .object({
    kind: z.enum(['order', 'retention']).default('order'),
    invoiceId: uuid.optional(),
    isAdvance: z.boolean().default(false),
    /** the receipts matched; all completed GRNs / certificates of the PO when omitted */
    grnIds: z.array(uuid).max(100).optional(),
    certificateIds: z.array(uuid).max(100).optional(),
    paymentMethod: z.enum(PAYMENT_METHODS),
    moneyAccountId: uuid,
    currency: currencyCode,
  })
  .strict()
  .refine((p) => p.kind !== 'order' || p.isAdvance || !!p.invoiceId, {
    message: 'A payment against an order needs an invoice',
    path: ['invoiceId'],
  })
  .refine((p) => !(p.isAdvance && p.invoiceId), {
    message: 'An advance is paid without an invoice',
    path: ['invoiceId'],
  })
  .refine((p) => p.kind === 'order' || !p.isAdvance, {
    message: 'A retention release is not an advance',
    path: ['isAdvance'],
  });
export type CreateOrderPaymentInput = z.input<typeof createOrderPaymentBody>;

/** PATCH /payment-requests/:id — draft or returned; the amounts are recomputed. */
export const paymentPatchBody = z
  .object({
    expectedVersion,
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    moneyAccountId: uuid.optional(),
  })
  .strict();
export type PaymentPatchInput = z.input<typeof paymentPatchBody>;

/** POST /payment-requests/:id/match-override — payment:override_match, not the preparer. */
export const matchOverrideBody = z.object({ expectedVersion, reason }).strict();
export type MatchOverrideInput = z.input<typeof matchOverrideBody>;

export const directPaymentLineInput = z
  .object({
    budgetLineId: uuid,
    locationOfficeId: uuid,
    activityId: uuid.optional(),
    description: z.string().trim().min(1).max(1000),
    amount: moneyString.refine((v) => Number(v) > 0, 'Must be greater than zero'),
  })
  .strict();

/** POST /direct-payments (US15) */
export const createDirectPaymentBody = z
  .object({
    payeeType: z.enum(PAYEE_TYPES),
    supplierId: uuid.optional(),
    staffPayeeId: uuid.optional(),
    payeeName: z.string().trim().min(1).max(300).optional(),
    grantId: uuid,
    categoryId: uuid,
    periodText: z.string().trim().max(200).optional(),
    paymentMethod: z.enum(PAYMENT_METHODS),
    moneyAccountId: uuid,
    currency: currencyCode,
    lines: z.array(directPaymentLineInput).min(1).max(200),
  })
  .strict()
  .refine(
    (p) =>
      (p.payeeType === 'supplier') === !!p.supplierId &&
      (p.payeeType === 'staff') === !!p.staffPayeeId &&
      (p.payeeType === 'other') === !!p.payeeName,
    { message: 'Name exactly one payee of the chosen type', path: ['payeeType'] }
  );
export type CreateDirectPaymentInput = z.input<typeof createDirectPaymentBody>;

export const paymentListQuery = listQuery.extend({
  status: z
    .enum(['draft', 'pending_approval', 'approved', 'paid', 'returned', 'rejected', 'cancelled'])
    .optional(),
  kind: z.enum(PAYMENT_REQUEST_KINDS).optional(),
  poId: uuid.optional(),
});
export type PaymentListQuery = z.infer<typeof paymentListQuery>;

/** GET /bank-accounts, /cash-boxes */
export const moneyAccountListQuery = z.object({
  currency: currencyCode.optional(),
  officeId: uuid.optional(),
  includeInactive: z.coerce.boolean().default(false),
});
export type MoneyAccountListQuery = z.infer<typeof moneyAccountListQuery>;

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export interface MoneyAccountView {
  id: string;
  kind: 'bank' | 'cash';
  name: string;
  bankName: string | null;
  branch: string | null;
  accountNo: string | null;
  currency: string;
  officeId: string;
  officeCode: string;
  glAccountId: string;
  glAccountCode: string;
  custodianUserId: string | null;
  openingBalance: string;
  openingDate: string | null;
  isActive: boolean;
  version: number;
}

export interface PaymentRequestSummary {
  id: string;
  docType: 'PAY' | 'DPR';
  kind: PaymentRequestKind;
  number: string | null;
  status: PaymentRequestStatus;
  isAdvance: boolean;
  poId: string | null;
  poNumber: string | null;
  payeeNameAr: string;
  payeeNameEn: string;
  currency: string;
  net: string;
  matchStatus: MatchStatus;
  createdAt: string;
}

export interface PaymentRequestLineView {
  id: string;
  lineNo: number;
  poLineId: string | null;
  description: string | null;
  quantity: string | null;
  unitPrice: string | null;
  gross: string;
  budgetLineId: string;
  budgetLineCode: string;
  locationOfficeId: string | null;
  activityId: string | null;
  invoicedQty: string | null;
  acceptedQty: string | null;
  poPrice: string | null;
  matchResult: MatchResult | null;
  amountGrant: string | null;
}

export interface PaymentDeductionView {
  id: string;
  deductionTypeId: string;
  nameAr: string;
  nameEn: string;
  base: string;
  ratePct: string;
  amount: string;
}

/** Charge-to table: one row per budget line × location × activity. */
export interface ChargeToRow {
  budgetLineId: string;
  budgetLineCode: string;
  locationOfficeId: string | null;
  activityId: string | null;
  /** payment currency */
  gross: string;
  /** grant currency */
  amountGrant: string | null;
}

export interface PaymentRequestDetail extends PaymentRequestSummary {
  version: number;
  officeId: string;
  createdBy: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  supplierInvoiceNo: string | null;
  supplierId: string | null;
  staffPayeeId: string | null;
  payeeBankName: string | null;
  payeeBankBranch: string | null;
  payeeAccountName: string | null;
  payeeAccountNo: string | null;
  grantId: string;
  grantCode: string;
  grantCurrency: string;
  paymentMethod: PaymentMethod;
  moneyAccountId: string;
  moneyAccountName: string;
  rateToBase: string;
  rateDate: string | null;
  poCurrency: string | null;
  poRateToBase: string | null;
  gross: string;
  advanceDeduction: string;
  retentionAmount: string;
  deductionsTotal: string;
  amountInWordsAr: string | null;
  amountInWordsEn: string | null;
  grnIds: string[];
  certificateIds: string[];
  paidOn: string | null;
  submissionCycle: number;
  currentStepOrder: number | null;
  returnReason: string | null;
  rejectReason: string | null;
  cancelReason: string | null;
  lines: PaymentRequestLineView[];
  deductions: PaymentDeductionView[];
  chargeTo: ChargeToRow[];
  override: { reason: string; userId: string; userName: string; at: string } | null;
  /** the voucher generated from it (US13) */
  voucher: { id: string; number: string | null; status: string } | null;
  steps: DocStepView[];
  /** edit, submit, override_match, generate_voucher plus the shared step actions */
  availableActions: string[];
}
