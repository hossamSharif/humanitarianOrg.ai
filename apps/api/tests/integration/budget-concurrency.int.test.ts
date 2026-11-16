// T098 — Available never goes negative (SC-003, FR-037): ten PRs that each fit the budget line
// alone but not together are submitted at once; the row lock lets exactly one through. The
// deferred trigger rejects an over-budget commitment even when written by plain SQL.
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

describe.runIf(integrationEnabled)('budget concurrency (US4)', () => {
  let tenant: TestTenant;
  let requester: TestUser;
  let token: string;
  let grantId: string;
  let budgetLineId: string;
  const prDate = todayInKhartoum();

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    tenant = await createTenant({ nameEn: 'Concurrency Org' });
    await createPrRouting(tenant);
    requester = await createUser(tenant, { roles: ['requester'] });
    await createUser(tenant, { roles: ['finance_checker'] });
    await createUser(tenant, { roles: ['approver'] });
    token = await tokenFor(requester);

    ({ id: grantId } = await createGrant(tenant, {
      startDate: addDays(prDate, -365),
      endDate: addDays(prDate, 365),
    }));
    // each PR: 870,710.00 SDG / 600 = 1,451.18 USD; two would need 2,902.36
    ({ id: budgetLineId } = await createBudgetLine(tenant, grantId, { budgetAmount: '2000.00' }));
    await createRate(tenant, { currency: 'USD', rateToBase: '600', rateDate: addDays(prDate, -5) });
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  it('ten parallel submits: exactly one reserves, nine get 422 BUDGET_EXCEEDED', async () => {
    const drafts = await Promise.all(
      Array.from({ length: 10 }, () =>
        createDraftPr(tenant, requester, { grantId, budgetLineId, prDate })
      )
    );
    const results = await Promise.all(
      drafts.map((d) => as(token).post(`/prs/${d.id}/submit`, { expectedVersion: 1 }))
    );

    const ok = results.filter((r) => r.status === 200);
    const exceeded = results.filter((r) => r.status === 422);
    expect(ok).toHaveLength(1);
    expect(exceeded).toHaveLength(9);
    for (const r of exceeded) {
      expect(r.body.code).toBe('BUDGET_EXCEEDED');
      expect(r.body.details.lines[0]).toMatchObject({
        budgetLineId,
        requested: '1451.18',
        available: '548.82',
        shortfall: '902.36',
        currency: 'USD',
      });
    }

    const [balance] = await ownerDb()<{ reserved: string; available: string }[]>`
      select reserved::text, available::text from public.budget_line_balance
      where budget_line_id = ${budgetLineId}`;
    expect(balance).toEqual({ reserved: '1451.18', available: '548.82' });

    // the failed submits left their PRs as untouched drafts
    const [counts] = await ownerDb()<{ drafts: number; pending: number }[]>`
      select count(*) filter (where status = 'draft' and number is null)::int as drafts,
             count(*) filter (where status = 'pending_finance_check')::int as pending
      from public.purchase_requisition where tenant_id = ${tenant.id}`;
    expect(counts).toEqual({ drafts: 9, pending: 1 });
  });

  it('the deferred trigger rejects an over-budget commitment written directly in SQL', async () => {
    const draft = await createDraftPr(tenant, requester, { grantId, budgetLineId, prDate });
    await expect(
      ownerDb().begin(async (sql) => {
        await sql`
          insert into public.budget_commitment (tenant_id, budget_line_id, pr_id, cycle, amount)
          values (${tenant.id}, ${budgetLineId}, ${draft.id}, 1, '600.00')`;
      })
    ).rejects.toMatchObject({ message: 'BUDGET_EXCEEDED' });

    const [balance] = await ownerDb()<{ available: string }[]>`
      select available::text from public.budget_line_balance where budget_line_id = ${budgetLineId}`;
    expect(balance!.available).toBe('548.82');
  });
});
