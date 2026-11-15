// T069 — US2 against local Supabase: donors / grants / budget lines / activities / rates through
// the API with grants:manage and rates:manage enforced, decimal-string balances, the spreadsheet
// import (preview then commit, one bad row), and a budget reduction racing a reservation.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupTestData,
  createDraftPr,
  createGrant,
  createRate,
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

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/budget-lines.xlsx'
);

describe.runIf(integrationEnabled)('funding (US2)', () => {
  let tenant: TestTenant;
  let admin: TestUser;
  let requester: TestUser;
  let adminToken: string;
  let requesterToken: string;

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    tenant = await createTenant({ nameEn: 'Funding Org' });
    admin = await createUser(tenant, { roles: ['org_admin'], orgWideAccess: true });
    requester = await createUser(tenant, { roles: ['requester'], offices: ['MAD'] });
    adminToken = await tokenFor(admin);
    requesterToken = await tokenFor(requester);
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  it('donor → grant → budget lines → activity, with permissions enforced', async () => {
    const forbidden = await as(requesterToken).post('/donors', { name: 'UNICEF' });
    expect(forbidden.status).toBe(403);

    const donor = await as(adminToken)
      .post('/donors', { name: 'ADRA', shortName: 'ADRA' })
      .expect(201);
    const grant = await as(adminToken)
      .post('/grants', {
        donorId: donor.body.id,
        code: 'ADRA-MAD-2026',
        name: 'Madani WASH',
        currency: 'USD',
        totalAmount: '50000.00',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        officeIds: [tenant.offices.MAD],
      })
      .expect(201);
    expect(grant.body).toMatchObject({ status: 'active', officeIds: [tenant.offices.MAD] });

    await as(adminToken)
      .post(`/grants/${grant.body.id}/budget-lines`, {
        code: '2.2.31',
        description: 'Training',
        category: 'services',
        budgetAmount: '12000.50',
      })
      .expect(201);
    await as(adminToken)
      .post(`/grants/${grant.body.id}/activities`, {
        code: 'A1',
        name: 'Training of Community Based Protection Networks',
      })
      .expect(201);

    // members read
    const lines = await as(requesterToken).get(`/grants/${grant.body.id}/budget-lines`).expect(200);
    expect(lines.body.data[0]).toEqual(
      expect.objectContaining({
        code: '2.2.31',
        budget: '12000.50',
        reserved: '0.00',
        committed: '0.00',
        actual: '0.00',
        available: '12000.50',
        pctUsed: '0.00',
      })
    );
    expect(lines.body.summary).toMatchObject({ difference: '37999.50', hasDifference: true });

    const detail = await as(requesterToken).get(`/grants/${grant.body.id}`).expect(200);
    expect(detail.body).toMatchObject({ budgetLinesTotal: '12000.50', pendingPrCount: 0 });

    const activities = await as(requesterToken).get(`/grants/${grant.body.id}/activities`);
    expect(activities.body.data).toHaveLength(1);

    const selectable = await as(requesterToken).get(
      `/grants?selectableFor=pr&prDate=2026-11-10&officeId=${tenant.offices.MAD}`
    );
    expect(selectable.body.data.map((g: { id: string }) => g.id)).toContain(grant.body.id);
    const otherOffice = await as(requesterToken).get(
      `/grants?selectableFor=pr&prDate=2026-11-10&officeId=${tenant.offices.KST}`
    );
    expect(otherOffice.body.data.map((g: { id: string }) => g.id)).not.toContain(grant.body.id);
  });

  it('exchange rates: rates:manage, lookup, in-use rows locked', async () => {
    expect(
      (
        await as(requesterToken).post('/exchange-rates', {
          currency: 'USD',
          rateToBase: '600',
          rateDate: '2026-11-01',
          source: 'Central Bank of Sudan',
        })
      ).status
    ).toBe(403);

    const rate = await as(adminToken)
      .post('/exchange-rates', {
        currency: 'EUR',
        rateToBase: '650.125',
        rateDate: '2026-11-01',
        source: 'Central Bank of Sudan',
      })
      .expect(201);
    expect(rate.body).toMatchObject({ rateToBase: '650.125000', inUse: false });

    const lookup = await as(requesterToken)
      .get('/exchange-rates/lookup?currency=EUR&date=2026-11-10')
      .expect(200);
    expect(lookup.body).toMatchObject({ exchangeRateId: rate.body.id, rateDate: '2026-11-01' });

    const base = await as(adminToken).post('/exchange-rates', {
      currency: 'SDG',
      rateToBase: '1',
      rateDate: '2026-11-01',
      source: 'x',
    });
    expect(base.body.code).toBe('EXCHANGE_RATE_BASE_CURRENCY');

    // reference it from a PR line, as a submitted PR would
    const grant = await createGrant(tenant);
    const [line] = await ownerDb()<{ id: string }[]>`
      insert into public.budget_line (tenant_id, grant_id, code, description, category, budget_amount)
      values (${tenant.id}, ${grant.id}, 'R1', 'x', 'supplies', 100) returning id`;
    const pr = await createDraftPr(tenant, requester, {
      grantId: grant.id,
      budgetLineId: line!.id,
    });
    await ownerDb()`update public.pr_line set exchange_rate_id = ${rate.body.id} where pr_id = ${pr.id}`;

    const list = await as(adminToken).get('/exchange-rates?currency=EUR').expect(200);
    expect(list.body.data.find((r: { id: string }) => r.id === rate.body.id).inUse).toBe(true);
    expect((await as(adminToken).delete(`/exchange-rates/${rate.body.id}`)).status).toBe(409);
    expect(
      (await as(adminToken).patch(`/exchange-rates/${rate.body.id}`, { rateToBase: '651' })).body
        .code
    ).toBe('EXCHANGE_RATE_IN_USE');

    const unused = await createRate(tenant, { currency: 'GBP' });
    await as(adminToken).delete(`/exchange-rates/${unused.id}`).expect(204);
  });

  it('import: preview reports the bad category row, commit creates only valid rows', async () => {
    const grant = await createGrant(tenant, { code: 'IMPORT-1' });
    const file = await readFile(FIXTURE);
    const upload = (mode: string) =>
      as(adminToken)
        .post(`/grants/${grant.id}/budget-lines/import?mode=${mode}`)
        .attach('file', file, 'budget-lines.xlsx');

    const preview = await upload('preview').expect(200);
    expect(preview.body.validRows.map((r: { code: string }) => r.code)).toEqual([
      '10202',
      '2.2.31',
      '010',
    ]);
    expect(preview.body.invalidRows).toEqual([
      expect.objectContaining({
        row: 5,
        errors: [{ column: 'category', code: 'invalid_category' }],
      }),
    ]);
    const before = await as(adminToken).get(`/grants/${grant.id}/budget-lines`);
    expect(before.body.data).toHaveLength(0);

    const commit = await upload('commit').expect(201);
    expect(commit.body.created).toBe(3);
    const after = await as(adminToken).get(`/grants/${grant.id}/budget-lines`);
    expect(after.body.data.map((l: { code: string }) => l.code).sort()).toEqual(
      ['010', '10202', '2.2.31'].sort()
    );

    // committing the same file again: every code now exists → no valid rows
    const again = await upload('commit');
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('IMPORT_INVALID_ROWS');
  });

  it('reducing a budget below usage loses to a concurrent reservation → 422 BUDGET_BELOW_USAGE', async () => {
    const grant = await createGrant(tenant, { code: 'RACE-1' });
    const created = await as(adminToken)
      .post(`/grants/${grant.id}/budget-lines`, {
        code: 'RACE',
        description: 'x',
        category: 'supplies',
        budgetAmount: '10000.00',
      })
      .expect(201);
    const lineId: string = created.body.id;
    const pr = await createDraftPr(tenant, requester, { grantId: grant.id, budgetLineId: lineId });
    const sql = ownerDb();
    await sql`
      update public.purchase_requisition
      set status = 'pending_finance_check', number = ${`PR-RACE-${Date.now()}`}
      where id = ${pr.id}`;
    await sql`
      insert into public.budget_commitment (tenant_id, budget_line_id, pr_id, cycle, amount)
      values (${tenant.id}, ${lineId}, ${pr.id}, 1, 4000)`;

    // A reservation holds the line lock while the PATCH (reduce to 5000) waits for it.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const reservation = sql.begin(async (tx) => {
      await tx`select id from public.budget_line where id = ${lineId} for update`;
      await tx`update public.budget_commitment set amount = 6000 where pr_id = ${pr.id}`;
      await gate;
    });
    await new Promise((r) => setTimeout(r, 200));
    const patch = as(adminToken)
      .patch(`/budget-lines/${lineId}`, { budgetAmount: '5000.00', expectedVersion: 1 })
      .then((res) => res);
    await new Promise((r) => setTimeout(r, 500));
    release();
    await reservation;

    const res = await patch;
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'BUDGET_BELOW_USAGE', details: { minimum: '6000.00' } });

    const ok = await as(adminToken)
      .patch(`/budget-lines/${lineId}`, { budgetAmount: '6000.00', expectedVersion: 1 })
      .expect(200);
    expect(ok.body).toMatchObject({ budgetAmount: '6000.00', version: 2 });
  });
});
