/**
 * Single entry point for applying the schema: packages/database/migrations/*.sql in filename
 * order (research R20). Each file runs in its own transaction and is recorded in
 * `supabase_migrations.schema_migrations`, the same history table the Supabase CLI and the
 * Supabase MCP `apply_migration` tool use, so all three paths see one consistent history.
 *
 *   pnpm --filter @ngo/database migrate            # apply pending migrations
 *   pnpm --filter @ngo/database migrate --status   # list applied / pending, change nothing
 *
 * DATABASE_URL defaults to the local stack started by `npx supabase start`. Use a direct (session)
 * connection here, not the transaction pooler.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

interface Migration {
  version: string;
  name: string;
  file: string;
}

async function listMigrations(): Promise<Migration[]> {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  return files.map((file) => {
    const match = MIGRATION_FILE.exec(file);
    if (!match) {
      throw new Error(`Migration file name must look like 0001_name.sql: ${file}`);
    }
    return { version: match[1]!, name: match[2]!, file };
  });
}

async function main(): Promise<void> {
  const statusOnly = process.argv.includes('--status');
  const sql = postgres(process.env.DATABASE_URL ?? LOCAL_DB_URL, { max: 1, onnotice: () => {} });

  try {
    await sql`create schema if not exists supabase_migrations`;
    await sql`
      create table if not exists supabase_migrations.schema_migrations (
        version text primary key,
        statements text[],
        name text
      )`;

    const applied = new Set(
      (
        await sql<{ version: string }[]>`select version from supabase_migrations.schema_migrations`
      ).map((r) => r.version)
    );
    const migrations = await listMigrations();
    const pending = migrations.filter((m) => !applied.has(m.version));

    for (const m of migrations) {
      console.log(`${applied.has(m.version) ? 'applied' : 'pending'}  ${m.file}`);
    }
    if (statusOnly || pending.length === 0) {
      console.log(pending.length === 0 ? 'Schema is up to date.' : `${pending.length} pending.`);
      return;
    }

    for (const m of pending) {
      const body = await readFile(path.join(migrationsDir, m.file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`
          insert into supabase_migrations.schema_migrations (version, statements, name)
          values (${m.version}, ${[body]}, ${m.name})`;
      });
      console.log(`migrated ${m.file}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
