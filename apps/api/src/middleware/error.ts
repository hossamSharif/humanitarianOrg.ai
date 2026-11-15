// Single error shape `{ code, message, details? }` (contracts/rest-api.md). Services throw
// AppError; Zod and Postgres errors are translated here.
import {
  ERROR_CODES,
  isErrorCode,
  type ErrorCode,
  type ErrorDetails,
  type FieldError,
} from '@ngo/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class AppError<C extends ErrorCode = ErrorCode> extends Error {
  readonly code: C;
  readonly details?: ErrorDetails<C>;

  constructor(code: C, message: string, details?: ErrorDetails<C>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_CODES[this.code];
  }
}

export function zodToAppError(error: ZodError, prefix?: string): AppError<'VALIDATION_ERROR'> {
  const details: FieldError[] = error.issues.map((issue) => ({
    field: [prefix, ...issue.path].filter((p) => p !== undefined && p !== '').join('.'),
    message: issue.message,
  }));
  return new AppError('VALIDATION_ERROR', 'Request validation failed', details);
}

interface PgLikeError {
  code?: unknown;
  message?: unknown;
  detail?: unknown;
  details?: unknown;
  constraint_name?: unknown;
  constraint?: unknown;
}

/**
 * Postgres errors from the `postgres` driver (code, message, detail, constraint_name) and
 * PostgREST errors from supabase-js (code, message, details). Guard triggers raise with the error
 * code as their message (e.g. 'BUDGET_EXCEEDED').
 */
export function fromPostgresError(error: unknown): AppError | null {
  if (typeof error !== 'object' || error === null) return null;
  const pg = error as PgLikeError;
  const sqlState = typeof pg.code === 'string' ? pg.code : undefined;
  const message = typeof pg.message === 'string' ? pg.message : '';
  if (!sqlState || !/^[0-9A-Z]{5}$/.test(sqlState)) return null;

  if (isErrorCode(message)) {
    const detail =
      typeof pg.detail === 'string' ? pg.detail : typeof pg.details === 'string' ? pg.details : '';
    return new AppError(message, detail || message);
  }

  const constraint =
    typeof pg.constraint_name === 'string'
      ? pg.constraint_name
      : typeof pg.constraint === 'string'
        ? pg.constraint
        : undefined;

  switch (sqlState) {
    case '23505': // unique_violation
      return new AppError('VALIDATION_ERROR', 'A record with these values already exists', [
        { field: constraint ?? 'unique', message: 'already_exists' },
      ]);
    case '23503': // foreign_key_violation
      return new AppError('VALIDATION_ERROR', 'A referenced record does not exist or is in use', [
        { field: constraint ?? 'reference', message: 'invalid_reference' },
      ]);
    case '23514': // check_violation
    case '23502': // not_null_violation
    case '22P02': // invalid_text_representation
      return new AppError('VALIDATION_ERROR', message || 'Invalid value', [
        { field: constraint ?? 'value', message: 'invalid_value' },
      ]);
    case '42501': // insufficient_privilege, incl. RLS "new row violates row-level security policy"
      return new AppError('FORBIDDEN', 'Not allowed');
    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return new AppError('VERSION_CONFLICT', 'Concurrent update, please retry');
    default:
      return null;
  }
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError('NOT_FOUND', 'Route not found'));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let appError: AppError;
  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = zodToAppError(err);
  } else if (err?.type === 'entity.parse.failed') {
    appError = new AppError('VALIDATION_ERROR', 'Malformed JSON body', [
      { field: 'body', message: 'invalid_json' },
    ]);
  } else if (err?.type === 'entity.too.large') {
    appError = new AppError('VALIDATION_ERROR', 'Request body too large', [
      { field: 'body', message: 'too_large' },
    ]);
  } else {
    appError = fromPostgresError(err) ?? new AppError('INTERNAL_ERROR', 'Internal server error');
  }

  if (appError.code === 'INTERNAL_ERROR') {
    console.error(`[${req.requestId}]`, err);
  }

  res.status(appError.status).json({
    code: appError.code,
    message: appError.message,
    ...(appError.details !== undefined ? { details: appError.details } : {}),
  });
};
