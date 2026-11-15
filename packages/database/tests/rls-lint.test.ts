/**
 * RLS lint (contracts/rls-and-permissions.md §1, Principle IV): every table in `public` has RLS
 * enabled, at least one policy, and every policy expression calls app.current_tenant_id(). Views
 * must be security_invoker so the caller's RLS applies.
 *
 * Needs a migrated database: DATABASE_URL (direct connection), default = local `supabase start`.
 */
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// Global reference tables with read-only `using (true)` policies; no tenant column.
const GLOBAL_TABLES = new Set(['currency', 'permission']);

const sql = postgres(process.env.DATABASE_URL ?? LOCAL_DB_URL, { max: 1, prepare: false });

afterAll(async () => {
  await sql.end();
});

interface TableRow {
  table_name: string;
  rls_enabled: boolean;
  policy_count: number;
}

interface PolicyRow {
  table_name: string;
  policy_name: string;
  qual: string | null;
  with_check: string | null;
}

describe('RLS lint', () => {
  it('every public table has RLS enabled and at least one policy', async () => {
    const tables = await sql<TableRow[]>`
      select c.relname as table_name,
             c.relrowsecurity as rls_enabled,
             (select count(*)::int from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname`;

    expect(tables.length).toBeGreaterThan(0);
    const offenders = tables
      .filter((t) => !t.rls_enabled || t.policy_count === 0)
      .map((t) => `${t.table_name} (rls=${t.rls_enabled}, policies=${t.policy_count})`);
    expect(offenders).toEqual([]);
  });

  it('every tenant policy expression calls app.current_tenant_id()', async () => {
    const policies = await sql<PolicyRow[]>`
      select tablename as table_name, policyname as policy_name, qual, with_check
      from pg_policies
      where schemaname = 'public'
      order by tablename, policyname`;

    const offenders = policies
      .filter((p) => !GLOBAL_TABLES.has(p.table_name))
      .filter((p) =>
        [p.qual, p.with_check]
          .filter((expr): expr is string => expr !== null)
          .some((expr) => !expr.includes('app.current_tenant_id()'))
      )
      .map((p) => `${p.table_name}.${p.policy_name}`);
    expect(offenders).toEqual([]);
  });

  it('global reference tables are read-only for API users', async () => {
    const writable = await sql<{ table_name: string; privilege_type: string }[]>`
      select table_name, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name in ('currency', 'permission')
        and grantee in ('anon', 'authenticated')
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`;
    expect(writable).toEqual([]);
  });

  it('every public view is security_invoker', async () => {
    const views = await sql<{ view_name: string; invoker: boolean }[]>`
      select c.relname as view_name,
             coalesce('security_invoker=true' = any (c.reloptions), false) as invoker
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'`;
    expect(views.filter((v) => !v.invoker).map((v) => v.view_name)).toEqual([]);
  });
});
