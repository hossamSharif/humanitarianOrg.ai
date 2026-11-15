// Postgres connection for transactional commands (research R4). Use Supavisor SESSION mode (5432):
// the API is a long-running server, and transaction mode (6543) hung when postgres.js pipelined
// queries onto a busy connection (integration run, 2026-11-15). prepare:false keeps either mode
// working. Settings are always transaction-local (see tx.ts), so pooled connections never carry
// one request's identity into the next.
import postgres from 'postgres';
import { getEnv } from '../config/env';

export type Sql = postgres.Sql;

let pool: Sql | undefined;

export function getPool(): Sql {
  if (!pool) {
    pool = postgres(getEnv().DATABASE_URL, {
      prepare: false,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end({ timeout: 5 });
    pool = undefined;
  }
}
