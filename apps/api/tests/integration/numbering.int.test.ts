// T099 — PR numbers (SC-007, FR-026, FR-004): assigned at first submission from a per
// office/year counter row, so parallel submits get distinct consecutive numbers, a rolled-back
// transaction consumes nothing, deleted drafts never had a number, and each office and year
// counts on its own. The year is the submission date's, not the PR date's.
import { addDays } from '@ngo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupTestData,
  createBudgetLine,
  createDraftPr,
  createGrant,
  createPrRouting,
  createRate,
  createTenant,
  createUser,
  todayInKhartoum,
  tokenFor,
  type TestTenant,
  type TestUser,
} from './helpers/factories';
import { as } from './helpers/http';
import { closeOwnerDb, ensureMigrated, integrationEnabled, ownerDb, truncateTenantTables } from './helpers/setup';

describe.runIf(integrationEnabled)('PR numbering (US4)', () => {
  let tenant: TestTenant;
  let requester: TestUser;
  let token: string;
  let grantId: string;
  let budgetLineId: string;
  const prDate = todayInKhartoum();
  const year = Number(prDate.slice(0, 4));

  const submit = (id: string) => as(token).post(`/prs/${id}/submit`, { expectedVersion: 1 });
  const draft = (office = 'MAD', date = prDate) =>
    createDraftPr(tenant, requester, { grantId, budgetLineId, prDate: date, office });

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    tenant = await createTenant({ nameEn: 'Numbering Org', officeCodes: ['MAD', 'KST', 'GDF'] });
    await createPrRouting(tenant);
    const offices = ['MAD', 'KST', 'GDF'];
    requester = await createUser(tenant, { roles: ['requester'], offices });
    await createUser(tenant, { roles: ['finance_checker'], offices });
    await createUser(tenant, { roles: ['approver'], offices });
    token = await tokenFor(requester);

    ({ id: grantId } = await createGrant(tenant, {
      startDate: `${year - 1}-01-01`,
      endDate: `${year + 1}-12-31`,
      offices,
    }));
    ({ id: budgetLineId } = await createBudgetLine(tenant, grantId, { budgetAmount: '1000000.00' }));
    await createRate(tenant, { currency: 'USD', rateDate: `${year - 1}-01-01` });
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  it('parallel submits in one office and year get distinct consecutive numbers', async () => {
    const drafts = await Promise.all(Array.from({ length: 5 }, () => draft('MAD')));
    const results = await Promise.all(drafts.map((d) => submit(d.id)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const numbers = results.map((r) => r.body.number as string).sort();
    expect(numbers).toEqual(
      [1, 2, 3, 4, 5].map((n) => `PR-MAD-${year}-${String(n).padStart(4, '0')}`)
    );
  });

  it('continues an existing sequence: last value 9 → PR-KST-YYYY-0010 (US4-1)', async () => {
    await ownerDb()`
      insert into public.document_sequence (tenant_id, doc_type, office_id, year, last_value)
      values (${tenant.id}, 'PR', ${tenant.offices.KST!}, ${year}, 9)`;
    const res = await submit((await draft('KST')).id);
    expect(res.status).toBe(200);
    expect(res.body.number).toBe(`PR-KST-${year}-0010`);
  });

  it('a rolled-back transaction consumes no number', async () => {
    const sql = ownerDb();
    await expect(
      sql.begin(async (tx) => {
        await tx`
          insert into public.document_sequence as s (tenant_id, doc_type, office_id, year, last_value)
          values (${tenant.id}, 'PR', ${tenant.offices.MAD!}, ${year}, 1)
          on conflict (tenant_id, doc_type, office_id, year)
            do update set last_value = s.last_value + 1`;
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');

    // a submit that fails its checks rolls back too
    const tooBig = await createDraftPr(tenant, requester, {
      grantId,
      budgetLineId,
      prDate,
      lines: [{ description: 'Generator', quantity: '1', unitCost: '999999999.00' }],
    });
    expect((await submit(tooBig.id)).body.code).toBe('BUDGET_EXCEEDED');

    const res = await submit((await draft('MAD')).id);
    expect(res.body.number).toBe(`PR-MAD-${year}-0006`);
  });

  it('a deleted draft leaves no gap', async () => {
    const created = await as(token).post('/prs', {
      header: { requestingOfficeId: tenant.offices.MAD },
    });
    expect(created.status).toBe(201);
    expect((await as(token).delete(`/prs/${created.body.id}`)).status).toBe(204);

    const res = await submit((await draft('MAD')).id);
    expect(res.body.number).toBe(`PR-MAD-${year}-0007`);
  });

  it('another office starts its own sequence, and an earlier year does not affect this one', async () => {
    await ownerDb()`
      insert into public.document_sequence (tenant_id, doc_type, office_id, year, last_value)
      values (${tenant.id}, 'PR', ${tenant.offices.GDF!}, ${year - 1}, 50)`;
    const res = await submit((await draft('GDF')).id);
    expect(res.body.number).toBe(`PR-GDF-${year}-0001`);
  });

  it('takes the year from the submission date, not the PR date (FR-004)', async () => {
    await ownerDb()`update public.tenant set max_backdate_days = 365 where id = ${tenant.id}`;
    const lastYear = addDays(`${year}-01-01`, -3); // 29/12 of the previous year
    const res = await submit((await draft('GDF', lastYear)).id);
    expect(res.status).toBe(200);
    expect(res.body.number).toBe(`PR-GDF-${year}-0002`);
  });
});
