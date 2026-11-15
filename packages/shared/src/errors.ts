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
