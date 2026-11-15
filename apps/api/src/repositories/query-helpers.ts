// Small helpers for repositories that issue their own supabase-js queries. PostgREST returns
// `numeric` as a JSON number, so money and rate columns are selected with a `::text` cast and
// stay exact decimal strings.
import type { ListResponse } from '@ngo/shared';
import { createUserClient, type UserClient } from '../db/supabase';
import { AppError, fromPostgresError } from '../middleware/error';
import type { RequestContext } from '../types/context';
import { BaseRepository, type ListOptions, type TableName } from './base.repository';

interface PostgrestLikeError {
  code?: string;
  message: string;
  details?: string | null;
}

interface PostgrestResult<T> {
  data: T | null;
  error: PostgrestLikeError | null;
  count?: number | null;
}

export function raise(error: PostgrestLikeError): never {
  throw fromPostgresError(error) ?? new AppError('INTERNAL_ERROR', error.message);
}

/** data or throw; `null` data is returned as-is (maybeSingle). */
export function unwrap<T>(result: PostgrestResult<T>): T | null {
  if (result.error) raise(result.error);
  return result.data;
}

export function unwrapList<T>(result: PostgrestResult<T[]>): T[] {
  if (result.error) raise(result.error);
  return result.data ?? [];
}

export function unwrapOne<T>(result: PostgrestResult<T>, what: string): T {
  const data = unwrap(result);
  if (data === null) throw new AppError('NOT_FOUND', `${what} not found`);
  return data;
}

/** Escapes LIKE wildcards so user text matches literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Table handle for repositories with their own column lists: raw supabase-js queries plus
 * BaseRepository's paginated list (same sort/filter rules and response shape).
 */
export class TableAccess {
  readonly db: UserClient;
  private readonly base: BaseRepository<Record<string, unknown>>;

  constructor(
    readonly ctx: RequestContext,
    readonly table: TableName,
    db?: UserClient
  ) {
    this.db = db ?? createUserClient(ctx.accessToken);
    this.base = new BaseRepository(ctx, table, this.db);
  }

  // supabase-js generics cannot express a table chosen at runtime (as in BaseRepository).
  from() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.db as any).from(this.table);
  }

  /** Paginated list; rows come back camelCased from the selected columns. */
  page<T>(options: ListOptions): Promise<ListResponse<T>> {
    return this.base.list(options) as unknown as Promise<ListResponse<T>>;
  }
}
