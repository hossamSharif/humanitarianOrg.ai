// T053 — organization setup through the API (US1): bootstrap with seeded defaults, profile
// permissions, office code rules (FR-002, US1-2), numbering preview (FR-004) and the audit trail
// of configuration changes (FR-005).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupTestData,
  createBudgetLine,
  createDraftPr,
  createGrant,
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

describe.runIf(integrationEnabled)('organization setup', () => {
  let tenant: TestTenant;
  let admin: TestUser;
  let requester: TestUser;
  let adminToken: string;
  let requesterToken: string;

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    tenant = await createTenant({ nameEn: 'Setup Org' });
    admin = await createUser(tenant, { roles: ['org_admin'], orgWideAccess: true });
    requester = await createUser(tenant, { roles: ['requester'] });
    adminToken = await tokenFor(admin);
    requesterToken = await tokenFor(requester);
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  describe('POST /tenants', () => {
    it('creates an organization whose creator is admin, with seeded defaults', async () => {
      const founder = await createUser(tenant, { roles: ['requester'] });
      const before = await tokenFor(founder);

      const res = await as(before)
        .post('/tenants', { nameAr: 'منظمة جديدة', nameEn: 'New Org', adminFullNameEn: 'Founder' })
        .expect(201);
      expect(res.body).toMatchObject({
        tenantId: expect.any(String),
        membershipId: expect.any(String),
        sessionRefreshRequired: true,
      });
      const newTenantId: string = res.body.tenantId;

      // a fresh token carries the new organization
      const after = await tokenFor(founder);
      const me = await as(after).get('/me').expect(200);
      expect(me.body.tenantId).toBe(newTenantId);
      expect(me.body.orgWideAccess).toBe(true);
      expect(me.body.permissions).toContain('settings:manage');
      expect(me.body.permissions).not.toContain('pr:approve');

      const sql = ownerDb();
      const [counts] = await sql<
        { units: number; roles: number; rules: number; steps: number; numbering: number }[]
      >`
        select
          (select count(*)::int from public.unit_of_measure where tenant_id = ${newTenantId}) as units,
          (select count(*)::int from public.role where tenant_id = ${newTenantId}) as roles,
          (select count(*)::int from public.approval_rule
            where tenant_id = ${newTenantId} and office_id is null) as rules,
          (select count(*)::int from public.approval_rule_step
            where tenant_id = ${newTenantId}) as steps,
          (select count(*)::int from public.numbering_config
            where tenant_id = ${newTenantId} and doc_type = 'PR') as numbering`;
      expect(counts).toEqual({ units: 11, roles: 5, rules: 1, steps: 2, numbering: 1 });

      const profile = await as(after).get('/tenant').expect(200);
      expect(profile.body).toMatchObject({
        nameEn: 'New Org',
        baseCurrency: 'SDG',
        doaReferenceCurrency: 'USD',
        timezone: 'Africa/Khartoum',
        maxBackdateDays: 30,
      });
    });

    it('400 when the bilingual names are missing', async () => {
      const res = await as(adminToken).post('/tenants', { nameEn: 'Only English' }).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET / PATCH /tenant', () => {
    it('members read the profile; PATCH requires settings:manage', async () => {
      await as(requesterToken).get('/tenant').expect(200);
      const denied = await as(requesterToken).patch('/tenant', { nameEn: 'Hacked' }).expect(403);
      expect(denied.body.code).toBe('FORBIDDEN');

      const res = await as(adminToken)
        .patch('/tenant', { nameEn: 'Setup Org Renamed', maxBackdateDays: 15 })
        .expect(200);
      expect(res.body).toMatchObject({ nameEn: 'Setup Org Renamed', maxBackdateDays: 15 });
    });

    it('rejects out-of-range settings', async () => {
      await as(adminToken).patch('/tenant', { maxBackdateDays: 400 }).expect(400);
      await as(adminToken).patch('/tenant', { fiscalYearStartMonth: 13 }).expect(400);
      await as(adminToken).patch('/tenant', { timezone: 'Mars/Base' }).expect(400);
    });

    it('issues a versioned logo upload path under the tenant folder', async () => {
      const res = await as(adminToken)
        .post('/tenant/logo-upload-url', { mimeType: 'image/png', sizeBytes: 2048 })
        .expect(200);
      expect(res.body.path).toMatch(new RegExp(`^${tenant.id}/logo-[0-9a-f-]{36}\\.png$`));
      expect(res.body.signedUrl).toEqual(expect.any(String));
      await as(requesterToken)
        .post('/tenant/logo-upload-url', { mimeType: 'image/png', sizeBytes: 2048 })
        .expect(403);
    });
  });

  describe('offices', () => {
    it('validates the code pattern and uniqueness', async () => {
      const bad = await as(adminToken)
        .post('/offices', { code: 'mad', nameAr: 'مدني', nameEn: 'Madani' })
        .expect(400);
      expect(bad.body.details[0].field).toBe('code');
      await as(adminToken)
        .post('/offices', { code: 'TOOLONGCODE1', nameAr: 'س', nameEn: 'X' })
        .expect(400);

      const dup = await as(adminToken)
        .post('/offices', { code: 'MAD', nameAr: 'مدني', nameEn: 'Madani' })
        .expect(400);
      expect(dup.body).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'code', message: 'already_exists' }],
      });

      const created = await as(adminToken)
        .post('/offices', { code: 'GDF', nameAr: 'القضارف', nameEn: 'Gadaref', phone: '+249' })
        .expect(201);
      expect(created.body).toMatchObject({ code: 'GDF', isActive: true, codeLocked: false });
    });

    it('requires settings:manage to write; members can list', async () => {
      await as(requesterToken)
        .post('/offices', { code: 'PZU', nameAr: 'بورتسودان', nameEn: 'Port Sudan' })
        .expect(403);
      const list = await as(requesterToken).get('/offices?active=true').expect(200);
      expect(list.body.data.length).toBeGreaterThan(0);
    });

    it('409 OFFICE_CODE_IN_USE when changing the code of an office used by a PR (US1-2)', async () => {
      const grant = await createGrant(tenant, { offices: ['KST'] });
      const line = await createBudgetLine(tenant, grant.id);
      await createDraftPr(tenant, admin, {
        grantId: grant.id,
        budgetLineId: line.id,
        office: 'KST',
      });

      const kst = tenant.offices.KST!;
      const res = await as(adminToken).patch(`/offices/${kst}`, { code: 'KOS' }).expect(409);
      expect(res.body.code).toBe('OFFICE_CODE_IN_USE');

      // other fields still change; the code shows as locked
      const renamed = await as(adminToken)
        .patch(`/offices/${kst}`, { nameEn: 'Kosti Office' })
        .expect(200);
      expect(renamed.body).toMatchObject({ code: 'KST', nameEn: 'Kosti Office', codeLocked: true });
    });

    it('deactivates instead of deleting', async () => {
      const mad = tenant.offices.MAD!;
      const res = await as(adminToken).patch(`/offices/${mad}`, { isActive: false }).expect(200);
      expect(res.body.isActive).toBe(false);
      await as(adminToken).delete(`/offices/${mad}`).expect(404);
      await as(adminToken).patch(`/offices/${mad}`, { isActive: true }).expect(200);
    });
  });

  describe('units', () => {
    it('creates, edits and deactivates units', async () => {
      const created = await as(adminToken)
        .post('/units', { code: 'ROLL', nameAr: 'لفة', nameEn: 'Roll' })
        .expect(201);
      const edited = await as(adminToken)
        .patch(`/units/${created.body.id}`, { nameEn: 'Roll (10 m)', isActive: false })
        .expect(200);
      expect(edited.body).toMatchObject({ nameEn: 'Roll (10 m)', isActive: false });
      await as(requesterToken).post('/units', { code: 'X', nameAr: 'س', nameEn: 'X' }).expect(403);
    });
  });

  describe('numbering', () => {
    it('GET /numbering/PR returns the config with a preview', async () => {
      await ownerDb()`
        insert into public.numbering_config (tenant_id, doc_type) values (${tenant.id}, 'PR')
        on conflict do nothing`;
      const res = await as(adminToken)
        .get(`/numbering/PR?officeId=${tenant.offices.MAD}`)
        .expect(200);
      expect(res.body).toMatchObject({
        docType: 'PR',
        prefix: 'PR',
        includeOffice: true,
        includeYear: true,
        padding: 4,
        separator: '-',
        preview: expect.stringMatching(/^PR-MAD-\d{4}-0001$/),
      });
      await as(requesterToken).get('/numbering/PR').expect(403);
    });

    it('PUT /numbering/PR saves and previews the new format', async () => {
      const res = await as(adminToken)
        .put('/numbering/PR', {
          prefix: 'RQ',
          includeOffice: true,
          includeYear: false,
          padding: 5,
          separator: '/',
        })
        .expect(200);
      expect(res.body.preview).toMatch(/^RQ\/[A-Z0-9]{2,10}\/00001$/);
      await as(adminToken)
        .put('/numbering/PR', {
          prefix: 'PR',
          includeOffice: true,
          includeYear: true,
          padding: 11,
          separator: '-',
        })
        .expect(400);
    });
  });

  describe('audit history (FR-005)', () => {
    it('records configuration changes with actor and changed fields', async () => {
      const rows = await ownerDb()<
        { table_name: string; action: string; actor_id: string; changed_fields: string[] | null }[]
      >`
        select table_name, action, actor_id, changed_fields
        from public.audit_history
        where tenant_id = ${tenant.id}
          and table_name in ('tenant', 'office', 'unit_of_measure', 'numbering_config')
          and actor_id = ${admin.id}`;
      const tables = new Set(rows.map((r) => r.table_name));
      expect(tables).toEqual(new Set(['tenant', 'office', 'unit_of_measure', 'numbering_config']));
      const tenantUpdate = rows.find((r) => r.table_name === 'tenant' && r.action === 'update');
      expect(tenantUpdate?.changed_fields).toEqual(
        expect.arrayContaining(['name_en', 'max_backdate_days'])
      );
    });
  });
});
