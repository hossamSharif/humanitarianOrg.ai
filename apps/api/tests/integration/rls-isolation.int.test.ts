// Tenant isolation (Principle IV, FR-006): a user of tenant A never sees or writes tenant B rows —
// through the API or directly through supabase-js with their own token — and a suspended
// membership loses access at once, without waiting for the token to expire.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  anonClient,
  createGrant,
  createTenant,
  createUser,
  cleanupTestData,
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

describe.runIf(integrationEnabled)('RLS isolation between tenants', () => {
  let tenantA: TestTenant;
  let tenantB: TestTenant;
  let userA: TestUser;
  let tokenA: string;
  let grantB: { id: string };

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    tenantA = await createTenant({ nameEn: 'Tenant A' });
    tenantB = await createTenant({ nameEn: 'Tenant B' });
    userA = await createUser(tenantA, { roles: ['org_admin'], orgWideAccess: true });
    await createUser(tenantB, { roles: ['org_admin'], orgWideAccess: true });
    grantB = await createGrant(tenantB);
    tokenA = await tokenFor(userA);
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  it('GET /me lists only the caller’s own organization', async () => {
    const res = await as(tokenA).get('/me').expect(200);
    expect(res.body.tenantId).toBe(tenantA.id);
    expect(res.body.memberships.map((m: { tenantId: string }) => m.tenantId)).toEqual([tenantA.id]);
    expect(res.body.offices.map((o: { id: string }) => o.id).sort()).toEqual(
      Object.values(tenantA.offices).sort()
    );
  });

  it('supabase-js reads return only tenant A rows', async () => {
    const db = anonClient(tokenA);
    const { data: offices } = await db.from('office').select('id, tenant_id');
    expect(offices?.length).toBeGreaterThan(0);
    expect(offices?.every((o) => o.tenant_id === tenantA.id)).toBe(true);

    const { data: foreignOffice } = await db
      .from('office')
      .select('id')
      .eq('id', tenantB.offices.MAD!)
      .maybeSingle();
    expect(foreignOffice).toBeNull();

    const { data: foreignGrant } = await db.from('grant').select('id').eq('id', grantB.id);
    expect(foreignGrant).toEqual([]);

    const { data: tenants } = await db.from('tenant').select('id');
    expect(tenants).toEqual([{ id: tenantA.id }]);
  });

  it('writes into tenant B are rejected', async () => {
    const db = anonClient(tokenA);
    const insert = await db
      .from('office')
      .insert({ tenant_id: tenantB.id, code: 'HACK', name_ar: 'x', name_en: 'x' });
    expect(insert.error?.code).toBe('42501');

    const update = await db
      .from('grant')
      .update({ name: 'changed' })
      .eq('id', grantB.id)
      .select('id');
    expect(update.data ?? []).toEqual([]);

    const [grant] = await ownerDb()<{ name: string }[]>`
      select name from public."grant" where id = ${grantB.id}`;
    expect(grant?.name).not.toBe('changed');
  });

  it('a forged tenant claim without membership sees nothing', async () => {
    // The token says tenant A; give the user's claim tenant B by switching — must be refused.
    const res = await as(tokenA).post('/session/tenant', { tenantId: tenantB.id });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('suspending the membership revokes access immediately (FR-006)', async () => {
    const victim = await createUser(tenantA, { roles: ['requester'] });
    const token = await tokenFor(victim);
    const db = anonClient(token);
    expect((await db.from('office').select('id')).data?.length).toBeGreaterThan(0);

    await ownerDb()`update public.membership set status = 'suspended' where id = ${victim.membershipId}`;

    // same, still-valid token
    expect((await db.from('office').select('id')).data).toEqual([]);
    const me = await as(token).get('/me').expect(200);
    expect(me.body.tenantId).toBeNull();
    expect(me.body.permissions).toEqual([]);
  });
});
