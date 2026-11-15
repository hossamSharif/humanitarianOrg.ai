// T085 — users, roles and approval rules through the API against a real database (US3):
// invitation → invited membership → activated by the first GET /me; suspension; role delete
// guard; approval rule validation (service and the 0011 guard); route preview with eligible
// counts; every configuration edit lands in audit_history.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  anonClient,
  cleanupTestData,
  createTenant,
  createUser,
  tokenFor,
  type TestTenant,
  type TestUser,
} from './helpers/factories';
import { as } from './helpers/http';
import {
  closeOwnerDb,
  ensureMigrated,
  integrationEnabled,
  ownerDb,
  truncateTenantTables,
} from './helpers/setup';

function admin() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Seeded default rule: finance check → Finance Checker, one open final band → Approver. */
async function createDefaultRule(tenant: TestTenant): Promise<string> {
  const sql = ownerDb();
  return sql.begin(async (tx) => {
    const [rule] = await tx<{ id: string }[]>`
      insert into public.approval_rule (tenant_id, office_id, name)
      values (${tenant.id}, null, 'Default PR approval') returning id`;
    await tx`
      insert into public.approval_rule_step (tenant_id, rule_id, step_order, kind, role_id)
      values (${tenant.id}, ${rule!.id}, 1, 'finance_check', ${tenant.roles.finance_checker}),
             (${tenant.id}, ${rule!.id}, 2, 'final_approval', ${tenant.roles.approver})`;
    return rule!.id;
  }) as Promise<string>;
}

describe.runIf(integrationEnabled)('US3 users, roles and approval rules', () => {
  let tenant: TestTenant;
  let adminUser: TestUser;
  let adminToken: string;
  let defaultRuleId: string;
  const invitedAuthIds: string[] = [];

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    tenant = await createTenant({ nameEn: 'US3 Org' });
    adminUser = await createUser(tenant, { roles: ['org_admin'], orgWideAccess: true });
    adminToken = await tokenFor(adminUser);
    defaultRuleId = await createDefaultRule(tenant);
  });

  afterAll(async () => {
    await cleanupTestData();
    for (const id of invitedAuthIds) await admin().auth.admin.deleteUser(id);
    await closeOwnerDb();
  });

  describe('users', () => {
    it('invite creates an invited membership with offices and roles; first GET /me activates it', async () => {
      const email = `invite-${randomUUID().slice(0, 8)}@example.org`;
      const res = await as(adminToken)
        .post('/users/invite', {
          email,
          fullNameAr: 'مستخدم مدعو',
          fullNameEn: 'Invited User',
          positionTitle: 'Program Officer',
          officeIds: [tenant.offices.MAD],
          roleIds: [tenant.roles.requester],
          orgWideAccess: false,
          locale: 'en',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        email,
        status: 'invited',
        orgWideAccess: false,
        roles: [{ id: tenant.roles.requester }],
        offices: [{ id: tenant.offices.MAD, code: 'MAD' }],
      });
      invitedAuthIds.push(res.body.userId);

      // the invitee sets a password (accept-invite page) and signs in
      const password = 'Invited-User-1!';
      await admin().auth.admin.updateUserById(res.body.userId, {
        password,
        app_metadata: { tenant_id: tenant.id },
      });
      const { data } = await anonClient().auth.signInWithPassword({ email, password });
      const me = await as(data.session!.access_token).get('/me').expect(200);
      expect(me.body.memberships).toEqual([
        expect.objectContaining({ tenantId: tenant.id, status: 'active' }),
      ]);
      expect(me.body.permissions).toEqual(expect.arrayContaining(['pr:create', 'pr:read']));

      const [row] = await ownerDb()<{ status: string; activated_at: Date | null }[]>`
        select status, activated_at from public.membership where id = ${res.body.membershipId}`;
      expect(row).toMatchObject({ status: 'active', activated_at: expect.any(Date) });
    });

    it('inviting an existing member is a validation error', async () => {
      const res = await as(adminToken).post('/users/invite', {
        email: adminUser.email,
        fullNameAr: 'x',
        fullNameEn: 'x',
        roleIds: [tenant.roles.viewer],
      });
      expect(res.status).toBe(400);
      expect(res.body.details).toEqual([{ field: 'email', message: 'already_member' }]);
    });

    it('rejects offices and roles of another tenant', async () => {
      const other = await createTenant({ nameEn: 'Other Org' });
      const res = await as(adminToken).post('/users/invite', {
        email: `x-${randomUUID().slice(0, 8)}@example.org`,
        fullNameAr: 'x',
        fullNameEn: 'x',
        officeIds: [other.offices.MAD],
        roleIds: [other.roles.requester],
      });
      expect(res.status).toBe(400);
      expect(res.body.details.map((d: { field: string }) => d.field)).toEqual([
        'officeIds.0',
        'roleIds.0',
      ]);
    });

    it('GET /users lists members with roles and offices', async () => {
      const res = await as(adminToken).get('/users?sort=email:asc').expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
      const me = res.body.data.find(
        (u: { membershipId: string }) => u.membershipId === adminUser.membershipId
      );
      expect(me.roles[0].id).toBe(tenant.roles.org_admin);
    });

    it('suspend removes access; the API refuses the suspended token', async () => {
      const member = await createUser(tenant, { roles: ['requester'] });
      const token = await tokenFor(member);
      await as(token).get('/me').expect(200);

      const res = await as(adminToken)
        .patch(`/users/${member.membershipId}`, { status: 'suspended', positionTitle: 'Former' })
        .expect(200);
      expect(res.body.status).toBe('suspended');

      const me = await as(token).get('/me').expect(200);
      expect(me.body.tenantId).toBeNull();
      expect((await anonClient(token).from('office').select('id')).data).toEqual([]);
    });

    it('an admin cannot suspend themselves', async () => {
      const res = await as(adminToken).patch(`/users/${adminUser.membershipId}`, {
        status: 'suspended',
      });
      expect(res.status).toBe(400);
    });

    it('without users:manage the endpoints are forbidden', async () => {
      const requester = await createUser(tenant, { roles: ['requester'] });
      const res = await as(await tokenFor(requester)).get('/users');
      expect(res.status).toBe(403);
    });
  });

  describe('roles', () => {
    it('GET /permissions returns the catalogue with bilingual descriptions', async () => {
      const res = await as(adminToken).get('/permissions').expect(200);
      expect(res.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'pr:approve',
            descriptionAr: expect.any(String),
            descriptionEn: expect.any(String),
          }),
        ])
      );
    });

    it('create, edit permissions, delete an unused role', async () => {
      const created = await as(adminToken)
        .post('/roles', {
          nameAr: 'مدير البرنامج',
          nameEn: 'Program Area Manager',
          permissions: ['pr:read', 'pr:approve'],
        })
        .expect(201);
      expect(created.body.permissions).toEqual(['pr:approve', 'pr:read']);

      const updated = await as(adminToken)
        .patch(`/roles/${created.body.id}`, {
          permissions: ['pr:read', 'pr:approve', 'budget:read'],
        })
        .expect(200);
      expect(updated.body.permissions).toEqual(['budget:read', 'pr:approve', 'pr:read']);

      await as(adminToken).delete(`/roles/${created.body.id}`).expect(204);
      await as(adminToken).get(`/roles/${created.body.id}`).expect(404);
    });

    it('delete is blocked while the role is assigned', async () => {
      const res = await as(adminToken).delete(`/roles/${tenant.roles.org_admin}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ROLE_IN_USE');
      expect(res.body.details.memberCount).toBeGreaterThan(0);
    });

    it('delete is blocked while an approval rule step requires the role', async () => {
      // finance_checker is unassigned in this tenant but required by the default rule
      const res = await as(adminToken).delete(`/roles/${tenant.roles.finance_checker}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ROLE_IN_USE');
      expect(res.body.details.ruleStepCount).toBe(1);
    });
  });

  describe('approval rules', () => {
    it('GET lists the default rule with its steps', async () => {
      const res = await as(adminToken).get('/approval-rules?docType=PR').expect(200);
      const rule = res.body.data.find((r: { id: string }) => r.id === defaultRuleId);
      expect(rule.steps.map((s: { kind: string }) => s.kind)).toEqual([
        'finance_check',
        'final_approval',
      ]);
    });

    it('PUT with an invalid rule → 422 APPROVAL_RULE_INVALID and nothing changes', async () => {
      const res = await as(adminToken).put(`/approval-rules/${defaultRuleId}`, {
        officeId: null,
        name: 'Broken',
        isActive: true,
        steps: [{ stepOrder: 1, kind: 'final_approval', roleId: tenant.roles.approver }],
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('APPROVAL_RULE_INVALID');
      expect(res.body.details.issues).toEqual(
        expect.arrayContaining([{ reason: 'first_step_not_finance_check', stepOrder: 1 }])
      );
      const [row] = await ownerDb()<{ name: string }[]>`
        select name from public.approval_rule where id = ${defaultRuleId}`;
      expect(row?.name).toBe('Default PR approval');
    });

    it('PUT with DoA bands replaces the steps; resolve picks the band (US3-1)', async () => {
      const pam = await as(adminToken)
        .post('/roles', {
          nameAr: 'مدير منطقة',
          nameEn: 'PAM',
          permissions: ['pr:read', 'pr:approve'],
        })
        .expect(201);
      await as(adminToken)
        .put(`/approval-rules/${defaultRuleId}`, {
          officeId: null,
          name: 'Default PR approval',
          isActive: true,
          steps: [
            { stepOrder: 1, kind: 'finance_check', roleId: tenant.roles.finance_checker },
            { stepOrder: 2, kind: 'final_approval', roleId: pam.body.id, maxAmount: '5000.00' },
            {
              stepOrder: 2,
              kind: 'final_approval',
              roleId: tenant.roles.approver,
              minAmount: '5000.00',
            },
          ],
        })
        .expect(200);

      await createUser(tenant, { roles: ['finance_checker'] });
      await createUser(tenant, { roles: ['approver'], offices: ['MAD'] });

      const low = await as(adminToken)
        .post('/approval-rules/resolve', { officeId: tenant.offices.MAD, amount: '5000.00' })
        .expect(200);
      expect(low.body.steps.map((s: { roleId: string }) => s.roleId)).toEqual([
        tenant.roles.finance_checker,
        pam.body.id,
      ]);
      // nobody holds PAM yet
      expect(low.body.steps.map((s: { eligibleCount: number }) => s.eligibleCount)).toEqual([1, 0]);

      const high = await as(adminToken)
        .post('/approval-rules/resolve', { officeId: tenant.offices.MAD, amount: '7000.00' })
        .expect(200);
      expect(high.body).toMatchObject({ currency: 'USD', ruleId: defaultRuleId });
      expect(high.body.steps[1]).toMatchObject({ roleId: tenant.roles.approver, eligibleCount: 1 });

      // the Madani approver has no access to Kosti
      const kosti = await as(adminToken)
        .post('/approval-rules/resolve', { officeId: tenant.offices.KST, amount: '7000.00' })
        .expect(200);
      expect(kosti.body.steps[1].eligibleCount).toBe(0);
    });

    it('an office rule takes precedence (US3-3)', async () => {
      const created = await as(adminToken)
        .post('/approval-rules', {
          officeId: tenant.offices.KST,
          name: 'Kosti',
          isActive: true,
          steps: [
            { stepOrder: 1, kind: 'finance_check', roleId: tenant.roles.finance_checker },
            { stepOrder: 2, kind: 'final_approval', roleId: tenant.roles.org_admin },
          ],
        })
        .expect(201);
      const res = await as(adminToken)
        .post('/approval-rules/resolve', { officeId: tenant.offices.KST, amount: '100.00' })
        .expect(200);
      expect(res.body.ruleId).toBe(created.body.id);
      // org_admin lacks pr:approve, so the preview shows nobody can sign
      expect(res.body.steps[1].eligibleCount).toBe(0);
    });

    it('the 0011 guard rejects an invalid rule written directly through PostgREST', async () => {
      const db = anonClient(adminToken);
      const { data: rule } = await db
        .from('approval_rule')
        .insert({ tenant_id: tenant.id, office_id: tenant.offices.MAD, name: 'Direct' })
        .select('id')
        .single();
      // a rule without steps cannot commit
      expect(rule).toBeNull();
      const [count] = await ownerDb()<{ n: number }[]>`
        select count(*)::int as n from public.approval_rule where name = 'Direct'`;
      expect(count?.n).toBe(0);
    });

    it('edits are recorded in audit_history', async () => {
      const rows = await ownerDb()<{ table_name: string; action: string }[]>`
        select table_name, action from public.audit_history
        where tenant_id = ${tenant.id}
          and table_name in ('membership', 'user_role', 'role', 'role_permission',
                             'approval_rule', 'approval_rule_step')`;
      const tables = new Set(rows.map((r) => r.table_name));
      for (const t of [
        'membership',
        'user_role',
        'role',
        'role_permission',
        'approval_rule',
        'approval_rule_step',
      ]) {
        expect(tables.has(t), t).toBe(true);
      }
      expect(rows.some((r) => r.table_name === 'approval_rule_step' && r.action === 'delete')).toBe(
        true
      );
    });
  });
});
