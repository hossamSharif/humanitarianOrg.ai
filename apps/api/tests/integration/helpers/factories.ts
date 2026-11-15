// Arrange real data for integration tests: tenants with seeded roles, Auth users with
// memberships, grants, budget lines, rates and draft PRs. Rows are written with the table-owner
// connection; tests then act through the API or supabase-js as the created users.
import { randomUUID } from 'node:crypto';
import { SEEDED_ROLES, type SeededRoleKey } from '@ngo/shared';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ownerDb, truncateTenantTables } from './setup';

const PASSWORD = 'Integration-Test-1!';

export interface TestTenant {
  id: string;
  roles: Record<SeededRoleKey, string>;
  offices: Record<string, string>;
  unitId: string;
}

export interface TestUser {
  id: string;
  email: string;
  membershipId: string;
  tenantId: string;
}

const createdUserIds: string[] = [];

function admin(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient(accessToken?: string): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
  });
}

/** Tenant with offices (default MAD, KST), the five seeded roles and a PCS unit. */
export async function createTenant(
  options: { nameEn?: string; officeCodes?: string[] } = {}
): Promise<TestTenant> {
  const sql = ownerDb();
  const nameEn = options.nameEn ?? `Test Org ${randomUUID().slice(0, 8)}`;
  const [tenant] = await sql<{ id: string }[]>`
    insert into public.tenant (name_ar, name_en) values (${`منظمة ${nameEn}`}, ${nameEn})
    returning id`;
  const tenantId = tenant!.id;

  // Multi-row inserts: a remote dev database costs ~0.3 s per round trip.
  const seeded = Object.values(SEEDED_ROLES);
  const roleRows = await sql<{ id: string; key: SeededRoleKey }[]>`
    insert into public.role ${sql(
      seeded.map((r) => ({
        tenant_id: tenantId,
        key: r.key,
        name_ar: r.nameAr,
        name_en: r.nameEn,
        is_system: true,
      }))
    )}
    returning id, key`;
  const roles = Object.fromEntries(roleRows.map((r) => [r.key, r.id])) as Record<
    SeededRoleKey,
    string
  >;
  await sql`
    insert into public.role_permission ${sql(
      seeded.flatMap((r) =>
        r.permissions.map((code) => ({
          role_id: roles[r.key],
          permission_code: code,
          tenant_id: tenantId,
        }))
      )
    )}`;

  const officeRows = await sql<{ id: string; code: string }[]>`
    insert into public.office ${sql(
      (options.officeCodes ?? ['MAD', 'KST']).map((code) => ({
        tenant_id: tenantId,
        code,
        name_ar: code,
        name_en: code,
      }))
    )}
    returning id, code`;
  const offices: Record<string, string> = Object.fromEntries(officeRows.map((o) => [o.code, o.id]));

  const [unit] = await sql<{ id: string }[]>`
    insert into public.unit_of_measure (tenant_id, code, name_ar, name_en)
    values (${tenantId}, 'PCS', 'قطعة', 'PCs') returning id`;

  return { id: tenantId, roles, offices, unitId: unit!.id };
}

/** Auth user + active membership with the given roles and offices; app_metadata.tenant_id set. */
export async function createUser(
  tenant: TestTenant,
  options: {
    roles?: SeededRoleKey[];
    offices?: string[];
    orgWideAccess?: boolean;
    status?: 'invited' | 'active' | 'suspended';
    email?: string;
  } = {}
): Promise<TestUser> {
  const email = options.email ?? `it-${randomUUID().slice(0, 12)}@example.org`;
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { tenant_id: tenant.id },
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  createdUserIds.push(data.user.id);

  const sql = ownerDb();
  const [membership] = await sql<{ id: string }[]>`
    insert into public.membership
      (tenant_id, user_id, email, full_name_ar, full_name_en, position_title, org_wide_access,
       status, invited_at, activated_at)
    values (${tenant.id}, ${data.user.id}, ${email}, ${'مستخدم اختبار'}, ${'Test User'},
            ${'Officer'}, ${options.orgWideAccess ?? false}, ${options.status ?? 'active'},
            now(), ${options.status === 'invited' ? null : sql`now()`})
    returning id`;

  const roleKeys = options.roles ?? ['requester'];
  if (roleKeys.length) {
    await sql`
      insert into public.user_role ${sql(
        roleKeys.map((key) => ({
          tenant_id: tenant.id,
          membership_id: membership!.id,
          role_id: tenant.roles[key],
        }))
      )}`;
  }
  const officeCodes = options.offices ?? ['MAD'];
  if (officeCodes.length) {
    await sql`
      insert into public.user_office ${sql(
        officeCodes.map((code) => ({
          tenant_id: tenant.id,
          membership_id: membership!.id,
          office_id: tenant.offices[code]!,
        }))
      )}`;
  }

  return { id: data.user.id, email, membershipId: membership!.id, tenantId: tenant.id };
}

/** Real access token for the user (signs in with the test password). */
export async function tokenFor(user: TestUser): Promise<string> {
  const { data, error } = await anonClient().auth.signInWithPassword({
    email: user.email,
    password: PASSWORD,
  });
  if (error || !data.session) throw new Error(`tokenFor: ${error?.message}`);
  return data.session.access_token;
}

/**
 * Removes everything a test file created: tenant data first (memberships reference auth.users with
 * on delete restrict), then the Auth users. Failures are reported, not swallowed.
 */
export async function cleanupTestData(): Promise<void> {
  await truncateTenantTables();
  const client = admin();
  const failures: string[] = [];
  for (const id of createdUserIds.splice(0)) {
    const { error } = await client.auth.admin.deleteUser(id);
    if (error) failures.push(`${id}: ${error.message}`);
  }
  if (failures.length) {
    throw new Error(`Could not delete test users:\n${failures.join('\n')}`);
  }
}

export async function createGrant(
  tenant: TestTenant,
  options: {
    code?: string;
    currency?: string;
    totalAmount?: string;
    startDate?: string;
    endDate?: string;
    offices?: string[];
    status?: 'active' | 'suspended' | 'closed';
  } = {}
): Promise<{ id: string; donorId: string }> {
  const sql = ownerDb();
  const [donor] = await sql<{ id: string }[]>`
    insert into public.donor (tenant_id, name, short_name)
    values (${tenant.id}, ${`ADRA ${randomUUID().slice(0, 6)}`}, 'ADRA') returning id`;
  const [grant] = await sql<{ id: string }[]>`
    insert into public."grant"
      (tenant_id, donor_id, code, name, currency, total_amount, start_date, end_date, status)
    values (${tenant.id}, ${donor!.id}, ${options.code ?? `G-${randomUUID().slice(0, 6)}`},
            'Emergency WASH', ${options.currency ?? 'USD'}, ${options.totalAmount ?? '100000.00'},
            ${options.startDate ?? '2026-01-01'}, ${options.endDate ?? '2026-12-31'},
            ${options.status ?? 'active'})
    returning id`;
  for (const code of options.offices ?? ['MAD']) {
    await sql`
      insert into public.grant_office (tenant_id, grant_id, office_id)
      values (${tenant.id}, ${grant!.id}, ${tenant.offices[code]!})`;
  }
  return { id: grant!.id, donorId: donor!.id };
}

export async function createBudgetLine(
  tenant: TestTenant,
  grantId: string,
  options: { code?: string; budgetAmount?: string; category?: string } = {}
): Promise<{ id: string }> {
  const [row] = await ownerDb()<{ id: string }[]>`
    insert into public.budget_line (tenant_id, grant_id, code, description, category, budget_amount)
    values (${tenant.id}, ${grantId}, ${options.code ?? '10202'}, 'Hygiene kits',
            ${options.category ?? 'supplies'}, ${options.budgetAmount ?? '10000.00'})
    returning id`;
  return { id: row!.id };
}

export async function createRate(
  tenant: TestTenant,
  options: { currency?: string; rateToBase?: string; rateDate?: string; source?: string } = {}
): Promise<{ id: string }> {
  const [row] = await ownerDb()<{ id: string }[]>`
    insert into public.exchange_rate (tenant_id, currency, rate_to_base, rate_date, source)
    values (${tenant.id}, ${options.currency ?? 'USD'}, ${options.rateToBase ?? '600'},
            ${options.rateDate ?? '2026-11-01'}, ${options.source ?? 'Central Bank of Sudan'})
    returning id`;
  return { id: row!.id };
}

export async function createDraftPr(
  tenant: TestTenant,
  requester: TestUser,
  options: {
    grantId: string;
    budgetLineId: string;
    office?: string;
    prDate?: string;
    lines?: { description: string; quantity: string; unitCost: string; currency?: string }[];
  }
): Promise<{ id: string }> {
  const sql = ownerDb();
  const officeId = tenant.offices[options.office ?? 'MAD']!;
  const [pr] = await sql<{ id: string }[]>`
    insert into public.purchase_requisition
      (tenant_id, pr_date, requesting_office_id, grant_id, deliver_to_office_id, pr_type,
       requester_id, created_by)
    values (${tenant.id}, ${options.prDate ?? '2026-11-10'}, ${officeId}, ${options.grantId},
            ${officeId}, 'goods', ${requester.id}, ${requester.id})
    returning id`;
  const lines = options.lines ?? [
    { description: 'Jerrycan 20 L', quantity: '10', unitCost: '87071.00', currency: 'SDG' },
  ];
  let lineNo = 1;
  for (const line of lines) {
    await sql`
      insert into public.pr_line
        (tenant_id, pr_id, line_no, description, quantity, unit_id, unit_cost, currency,
         budget_line_id, location_office_id)
      values (${tenant.id}, ${pr!.id}, ${lineNo++}, ${line.description}, ${line.quantity},
              ${tenant.unitId}, ${line.unitCost}, ${line.currency ?? 'SDG'},
              ${options.budgetLineId}, ${officeId})`;
  }
  return { id: pr!.id };
}
