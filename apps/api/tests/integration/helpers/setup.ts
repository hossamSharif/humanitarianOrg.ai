// Integration harness: a migrated Supabase (local `supabase start`, or a dev project) and real
// Auth users. Needs apps/api/.env.local (or the environment) with SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL (direct/session connection, a
// role that owns the tables, e.g. `postgres`).
//
// Without those values the suites are skipped (`describe.runIf(integrationEnabled)`).
// Truncation between files runs only against a local database, or when ALLOW_DB_TRUNCATE=1 —
// never by accident against a shared project.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && process.env[match[1]!] === undefined) {
      process.env[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env.local'));

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL'];
export const missingEnv = REQUIRED.filter((name) => !process.env[name]);
export const integrationEnabled = missingEnv.length === 0;

if (!integrationEnabled) {
  console.warn(
    `[integration] skipped — missing ${missingEnv.join(', ')} (see apps/api/.env.example)`
  );
}

export const isLocalDb = () => /@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? '');

let ownerSql: postgres.Sql | undefined;

/** Table-owner connection: bypasses RLS. For arranging data and asserting raw state only. */
export function ownerDb(): postgres.Sql {
  if (!ownerSql) {
    ownerSql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });
  }
  return ownerSql;
}

export async function closeOwnerDb(): Promise<void> {
  await ownerSql?.end({ timeout: 5 });
  ownerSql = undefined;
}

let migrated = false;

/** Applies pending migrations once per run (packages/database/scripts/migrate.ts is idempotent). */
export function ensureMigrated(): void {
  if (migrated) return;
  const script = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../../packages/database/scripts/migrate.ts'
  );
  execFileSync('npx', ['tsx', script], {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  migrated = true;
}

/** Tables with tenant data, children first. Global reference data (currency, permission) stays. */
const TENANT_TABLES = [
  'notification',
  'idempotency_key',
  'budget_commitment',
  'approval_action',
  'pr_approval_step',
  'pr_attachment',
  'pr_line',
  'purchase_requisition',
  'exchange_rate',
  'budget_line',
  'activity',
  'grant_office',
  'grant',
  'donor',
  'approval_rule_step',
  'approval_rule',
  'document_sequence',
  'numbering_config',
  'unit_of_measure',
  'user_role',
  'role_permission',
  'role',
  'user_office',
  'office',
  'membership',
  'audit_history',
  'tenant',
];

/** Clears tenant data (TRUNCATE skips the append-only row triggers). */
export async function truncateTenantTables(): Promise<void> {
  if (!isLocalDb() && process.env.ALLOW_DB_TRUNCATE !== '1') {
    throw new Error(
      'Refusing to truncate a non-local database. Set ALLOW_DB_TRUNCATE=1 for a disposable dev project.'
    );
  }
  const list = TENANT_TABLES.map((t) => `public."${t}"`).join(', ');
  await ownerDb().unsafe(`truncate ${list} restart identity cascade`);
}
