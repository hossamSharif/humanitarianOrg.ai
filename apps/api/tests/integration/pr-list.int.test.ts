// T142 — `GET /prs` (FR-046): filters by status (repeatable), office, grant, requester, PR date
// range, grant-currency amount range and search by number or line description; pagination and
// sorting; and the list's p95 latency at seeded scale (1,000 extra approved PRs).
import { addDays } from '@ngo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { percentile, seedApprovedPrs, timed } from './helpers/bulk';
import {
  cleanupTestData,
  createBudgetLine,
  createDraftPr,
  createGrant,
  createUser,
  tokenFor,
  type TestUser,
} from './helpers/factories';
import { as } from './helpers/http';
import { actOnStep, createFlow, submitPr, type Flow } from './helpers/pr-flow';
import {
  closeOwnerDb,
  ensureMigrated,
  integrationEnabled,
  isLocalDb,
  truncateTenantTables,
} from './helpers/setup';

interface Item {
  id: string;
  number: string | null;
}

describe.runIf(integrationEnabled)('PR list (US8)', { timeout: 300_000 }, () => {
  let flow: Flow;
  let requester2: TestUser;
  const ids = {} as Record<'draft' | 'pending' | 'approved' | 'small' | 'kosti' | 'other', string>;
  let approvedNumber: string;
  let kostiGrantId: string;
  let bulkGrantId: string;

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    flow = await createFlow({ nameEn: 'List Org' });
    const { tenant, grantId, budgetLineId, prDate } = flow;

    ids.draft = (
      await createDraftPr(tenant, flow.requester.user, { grantId, budgetLineId, prDate })
    ).id;
    ids.pending = (await submitPr(flow)).id;
    const approved = await submitPr(flow);
    ids.approved = approved.id;
    approvedNumber = approved.number;
    expect((await actOnStep(flow.finance.token, ids.approved, 'approve')).status).toBe(200);
    expect((await actOnStep(flow.approver.token, ids.approved, 'approve')).status).toBe(200);

    // 1 × 60,000.00 SDG = 100.00 USD
    const small = await createDraftPr(tenant, flow.requester.user, {
      grantId,
      budgetLineId,
      prDate,
      lines: [{ description: 'Soap bar', quantity: '1', unitCost: '60000.00' }],
    });
    const submitted = await as(flow.requester.token).post(`/prs/${small.id}/submit`, {
      expectedVersion: 1,
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    ids.small = small.id;

    const kosti = await createGrant(tenant, { offices: ['KST'], startDate: '2025-01-01' });
    kostiGrantId = kosti.id;
    const kostiLine = await createBudgetLine(tenant, kostiGrantId);
    ids.kosti = (
      await createDraftPr(tenant, flow.requester.user, {
        grantId: kostiGrantId,
        budgetLineId: kostiLine.id,
        office: 'KST',
        prDate: addDays(prDate, -200),
        lines: [{ description: 'Plastic sheeting 4x6 m', quantity: '5', unitCost: '1000.00' }],
      })
    ).id;

    requester2 = await createUser(tenant, { roles: ['requester'] });
    ids.other = (await createDraftPr(tenant, requester2, { grantId, budgetLineId, prDate })).id;

    const bulk = await createGrant(tenant, { totalAmount: '1000000.00' });
    bulkGrantId = bulk.id;
    const bulkLine = await createBudgetLine(tenant, bulkGrantId, { budgetAmount: '100000.00' });
    await seedApprovedPrs(tenant, flow.requester.user, {
      grantId: bulkGrantId,
      budgetLineIds: [bulkLine.id],
      count: 1000,
      linesPerPr: 5,
      prDate,
    });
  }, 600_000);

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  const list = async (query: string) => {
    const res = await as(flow.admin.token).get(`/prs?${query}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as { data: Item[]; page: number; pageSize: number; total: number };
  };
  const idsOf = async (query: string) => (await list(query)).data.map((p) => p.id).sort();
  const sorted = (...values: string[]) => [...values].sort();

  it('filters by status, repeatable or in bracket form', async () => {
    expect(
      await idsOf(`grantId=${flow.grantId}&status=draft&status=pending_finance_check`)
    ).toEqual(sorted(ids.draft, ids.other, ids.pending, ids.small));
    expect(await idsOf(`grantId=${flow.grantId}&status[]=approved`)).toEqual([ids.approved]);
  });

  it('filters by office, grant and requester', async () => {
    expect(await idsOf(`officeId=${flow.tenant.offices.KST}`)).toEqual([ids.kosti]);
    expect(await idsOf(`grantId=${kostiGrantId}`)).toEqual([ids.kosti]);
    expect(await idsOf(`requesterId=${requester2.id}`)).toEqual([ids.other]);
  });

  it('filters by PR date range', async () => {
    expect(await idsOf(`dateTo=${addDays(flow.prDate, -100)}`)).toEqual([ids.kosti]);
    expect(
      await idsOf(`grantId=${flow.grantId}&dateFrom=${flow.prDate}&dateTo=${flow.prDate}`)
    ).toEqual(sorted(ids.draft, ids.other, ids.pending, ids.approved, ids.small));
  });

  it('filters by amount in the grant currency (submitted PRs only)', async () => {
    expect(await idsOf(`grantId=${flow.grantId}&amountMin=500`)).toEqual(
      sorted(ids.pending, ids.approved)
    );
    expect(await idsOf(`grantId=${flow.grantId}&amountMax=500`)).toEqual([ids.small]);
    expect(await idsOf(`grantId=${flow.grantId}&amountMin=100&amountMax=100`)).toEqual([ids.small]);
  });

  it('searches by number and by line description, case-insensitively', async () => {
    expect(await idsOf(`q=${encodeURIComponent(approvedNumber)}`)).toEqual([ids.approved]);
    expect(await idsOf('q=SOAP')).toEqual([ids.small]);
    expect(await idsOf('q=sheeting')).toEqual([ids.kosti]);
    // LIKE wildcards are literal
    expect(await idsOf('q=%25')).toEqual([]);
  });

  it('returns list items with office, grant, requester and totals', async () => {
    const { data } = await list(`q=${encodeURIComponent(approvedNumber)}`);
    expect(data[0]).toMatchObject({
      id: ids.approved,
      number: approvedNumber,
      status: 'approved',
      prDate: flow.prDate,
      office: { id: flow.tenant.offices.MAD, code: 'MAD' },
      grant: { id: flow.grantId, currency: 'USD' },
      requester: { id: flow.requester.user.id, nameEn: 'Test User' },
      totals: [{ amount: '870710.00', currency: 'SDG' }],
      totalGrantCurrency: { amount: '1451.18', currency: 'USD' },
    });
  });

  it('paginates and sorts', async () => {
    const page2 = await list(`grantId=${bulkGrantId}&page=2&pageSize=50&sort=number:asc`);
    expect(page2).toMatchObject({ page: 2, pageSize: 50, total: 1000 });
    expect(page2.data).toHaveLength(50);
    expect(page2.data[0]!.number).toBe('BULK-000051');

    const desc = await list(`grantId=${bulkGrantId}&pageSize=1&sort=number:desc`);
    expect(desc.data[0]!.number).toBe('BULK-001000');
  });

  it('rejects unknown statuses and sort fields', async () => {
    for (const query of ['status=bogus', 'sort=secret:asc', 'amountMin=abc', 'pageSize=500']) {
      const res = await as(flow.admin.token).get(`/prs?${query}`);
      expect(res.status, query).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('requires pr:read', async () => {
    const outsider = await createUser(flow.tenant, { roles: [] });
    const res = await as(await tokenFor(outsider)).get('/prs');
    expect(res.status).toBe(403);
  });

  it('p95 under 500 ms at seeded scale (FR-046)', async () => {
    const sample = async (query: string, n = 20) => {
      await list(query); // warm-up
      const ms: number[] = [];
      for (let i = 0; i < n; i++) ms.push((await timed(() => list(query))).ms);
      return percentile(ms, 95);
    };
    const full = Math.max(await sample('pageSize=50'), await sample('q=bulk&pageSize=50'));
    if (isLocalDb()) {
      expect(full).toBeLessThan(500);
    } else {
      // a remote dev database adds ~0.2 s per round trip; compare the query cost against the same
      // request shape returning nothing
      const baseline = await sample('status=rejected&pageSize=1');
      console.info(`[perf] GET /prs p95 ${full.toFixed(0)} ms, baseline ${baseline.toFixed(0)} ms`);
      expect(full - baseline).toBeLessThan(500);
    }
  });
});
