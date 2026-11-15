// Unit of work for PR commands and budget-line amount edits (contracts/rls-and-permissions.md §2).
// Every statement inside runs as `authenticated` with the caller's verified JWT claims, so RLS,
// auth.uid() and the audit trigger behave exactly as through supabase-js.
import type postgres from 'postgres';
import { getPool, type Sql } from './pool';

export interface TxContext {
  /** Verified JWT payload from the auth middleware. */
  claims: Record<string, unknown>;
  requestId: string;
}

export type TxSql = postgres.TransactionSql;

export interface TenantTx {
  sql: TxSql;
  /** Reason/comment recorded by the audit trigger for the writes that follow. */
  setAuditComment(comment: string | null): Promise<void>;
}

export async function withTenantTx<T>(
  ctx: TxContext,
  fn: (tx: TenantTx) => Promise<T>,
  sql: Sql = getPool()
): Promise<T> {
  const result = await sql.begin(async (tsql) => {
    await tsql.unsafe('set local role authenticated');
    await tsql`
      select
        set_config('request.jwt.claims', ${JSON.stringify(ctx.claims)}, true),
        set_config('app.request_id', ${ctx.requestId}, true),
        set_config('app.audit_comment', '', true)`;

    return fn({
      sql: tsql,
      async setAuditComment(comment) {
        await tsql`select set_config('app.audit_comment', ${comment ?? ''}, true)`;
      },
    });
  });
  return result as T;
}
