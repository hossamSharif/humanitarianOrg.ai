// API error codes and HTTP statuses (contracts/rest-api.md "Error codes"). Every API error is
// `{ code, message, details? }`; clients render `errors.<code>` from the i18n messages.

export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  SEGREGATION_OF_DUTIES: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  INVALID_STATE: 409,
  OFFICE_CODE_IN_USE: 409,
  EXCHANGE_RATE_IN_USE: 409,
  // US3: deleting a role that is assigned or required by an approval step.
  ROLE_IN_USE: 409,
  BUDGET_EXCEEDED: 422,
  BUDGET_BELOW_USAGE: 422,
  GRANT_NOT_ACTIVE: 422,
  GRANT_PERIOD_MISMATCH: 422,
  PR_DATE_OUT_OF_RANGE: 422,
  GRANT_OFFICE_MISMATCH: 422,
  EXCHANGE_RATE_MISSING: 422,
  PR_EMPTY: 422,
  REQUIRED_BY_BEFORE_PR_DATE: 422,
  NO_ELIGIBLE_APPROVER: 422,
  APPROVAL_RULE_INVALID: 422,
  IMPORT_INVALID_ROWS: 422,
  // Raised by DB guard triggers (migrations 0004/0005); not in the original contract table.
  PR_LINE_GRANT_MISMATCH: 422,
  EXCHANGE_RATE_BASE_CURRENCY: 422,
  // US2: changing the currency of a grant whose budget lines carry commitments.
  GRANT_CURRENCY_LOCKED: 409,
  // 002 (contracts/rest-api.md "New error codes")
  PROCUREMENT_BANDS_INVALID: 422,
  METHOD_BELOW_REQUIRED: 422,
  CRITERIA_WEIGHTS_INVALID: 422,
  TOO_FEW_SUPPLIERS: 422,
  SUPPLIER_NOT_ELIGIBLE: 422,
  PR_LINE_ALREADY_SOURCING: 409,
  MIXED_GRANTS: 422,
  SPLITTING_ACK_REQUIRED: 422,
  SOURCING_NOT_OPENED: 409,
  DEADLINE_NOT_PASSED: 409,
  TOO_FEW_ATTENDEES: 422,
  OFFER_LATE: 409,
  OFFER_FROZEN: 409,
  DECLARATION_REQUIRED: 403,
  COMMITTEE_TOO_SMALL: 422,
  JUSTIFICATION_REQUIRED: 422,
  SPLIT_AWARD_NOT_ALLOWED: 422,
  INHERITED_FIELD_MISMATCH: 422,
  MILESTONES_INVALID: 422,
  PO_NOT_ACKNOWLEDGED: 409,
  OVER_RECEIPT: 422,
  OVER_CERTIFIED: 422,
  DUPLICATE_INVOICE: 409,
  MATCH_FAILED: 422,
  PO_OVERPAID: 422,
  ADVANCE_LIMIT_EXCEEDED: 422,
  PROCUREMENT_ONLY_CATEGORY: 422,
  ADVANCE_OVERDUE: 422,
  CURRENCY_MISMATCH: 422,
  BUDGET_LINE_UNMAPPED: 422,
  VOUCHER_UNBALANCED: 422,
  RATE_CURRENCY_CONTRADICTION: 422,
  PERIOD_CLOSED: 409,
  VOUCHER_POSTED_IMMUTABLE: 409,
  RECEIVED_BY_REQUIRED: 422,
  REASON_REQUIRED: 422,
  ALLOCATION_NOT_100: 422,
  RECONCILIATION_UNBALANCED: 422,
  ACCOUNT_IN_USE: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export const ERROR_CODE_LIST = Object.keys(ERROR_CODES) as ErrorCode[];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODES, value);
}

export function httpStatusFor(code: ErrorCode): number {
  return ERROR_CODES[code];
}

// ---------------------------------------------------------------------------------------------
// Structured details per code
// ---------------------------------------------------------------------------------------------

export interface FieldError {
  field: string;
  message: string;
}

export interface BudgetShortfallLine {
  budgetLineId: string;
  code: string;
  /** decimal strings in the grant currency */
  requested: string;
  available: string;
  shortfall: string;
  currency: string;
  prLineIds: string[];
}

export interface ErrorDetailsMap {
  VALIDATION_ERROR: FieldError[];
  BUDGET_EXCEEDED: { lines: BudgetShortfallLine[] };
  BUDGET_BELOW_USAGE: { minimum: string };
  EXCHANGE_RATE_MISSING: { currencies: string[]; date: string };
  PR_DATE_OUT_OF_RANGE: { prDate: string; earliest: string; latest: string };
  NO_ELIGIBLE_APPROVER: {
    stepOrder: number;
    kind: string;
    roleId: string;
    roleName: string;
    ruleId: string;
  };
  APPROVAL_RULE_INVALID: { issues: { reason: string; stepOrder?: number }[] };
  ROLE_IN_USE: { memberCount: number; ruleStepCount: number; prStepCount: number };
  // 002
  SEGREGATION_OF_DUTIES: { rule: SegregationRule };
  PROCUREMENT_BANDS_INVALID: {
    gaps: [string | null, string | null][];
    overlaps: [string | null, string | null][];
  };
  METHOD_BELOW_REQUIRED: {
    required: string;
    chosen: string;
    estimatedValue: string;
    currency: string;
  };
  CRITERIA_WEIGHTS_INVALID: { stage: string; total: string };
  TOO_FEW_SUPPLIERS: { required: number; actual: number };
  SUPPLIER_NOT_ELIGIBLE: { supplierId: string; reasons: string[] };
  PR_LINE_ALREADY_SOURCING: { prLineIds: string[]; eventId: string };
  SPLITTING_ACK_REQUIRED: { prIds: string[]; total: string; bandMax: string };
  DEADLINE_NOT_PASSED: { deadline: string; now: string };
  COMMITTEE_TOO_SMALL: { minimum: number; eligible: number };
  OVER_RECEIPT: {
    poLineId: string;
    ordered: string;
    alreadyAccepted: string;
    tolerancePct: string;
    maxAcceptable: string;
  };
  MATCH_FAILED: { lines: MatchFailedLine[] };
  PO_OVERPAID: { total: string; requested: string; remaining: string };
  ADVANCE_OVERDUE: { advanceIds: string[]; daysOverdue: number };
  BUDGET_LINE_UNMAPPED: { budgetLineIds: string[]; codes: string[] };
  VOUCHER_UNBALANCED: { baseDebit: string; baseCredit: string; difference: string };
  PERIOD_CLOSED: { year: number; month: number };
}

/** Separation-of-duties rule ids (contracts/rls-and-permissions.md §3). */
export const SEGREGATION_RULES = [
  'creator_approves',
  'same_user_two_steps',
  'pr_creator_approves_award',
  'receiver_is_inspector',
  'certifier_is_confirmer',
  'preparer_approves_payment',
  'receiver_approves_payment',
  'voucher_three_people',
  'override_by_preparer',
  'undeclared_member_scores',
] as const;
export type SegregationRule = (typeof SEGREGATION_RULES)[number];

export interface MatchFailedLine {
  lineId: string;
  result: string;
  invoicedQty: string;
  acceptedQty: string;
  invoicedPrice: string;
  poPrice: string;
  tolerancePct: string;
}

export type ErrorDetails<C extends ErrorCode> = C extends keyof ErrorDetailsMap
  ? ErrorDetailsMap[C]
  : unknown;

export interface ApiError<C extends ErrorCode = ErrorCode> {
  code: C;
  /** English, for logs; clients render i18n by `code`. */
  message: string;
  details?: ErrorDetails<C>;
}

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    isErrorCode((value as { code?: unknown }).code) &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}
