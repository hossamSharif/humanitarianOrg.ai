// T147 — SC-004: the budget status report of a grant appears in under 2 seconds for an
// organization with 5,000 PRs (~50,000 lines). Seeded with set-based inserts (helpers/bulk.ts);
// timed through HTTP after one warm-up call. Against a remote dev database every request pays
// ~0.2 s per round trip regardless of data, so there the target applies to the time above the
// same report for an empty grant.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedApprovedPrs, timed } from './helpers/bulk';
import { cleanupTestData, createBudgetLine, createGrant } from './helpers/factories';
import { as } from './helpers/http';
import { createFlow, type Flow } from './helpers/pr-flow';
import {
  closeOwnerDb,
  ensureMigrated,
  integrationEnabled,
  isLocalDb,
  truncateTenantTables,
} from './helpers/setup';

const PRS = 5000;
const LINES_PER_PR = 10;
const BUDGET_LINES = 50;

describe.runIf(integrationEnabled)(
  'Budget report performance (SC-004)',
  { timeout: 600_000 },
  () => {
    let flow: Flow;
    let emptyGrantId: string;

    beforeAll(async () => {
      ensureMigrated();
      await truncateTenantTables();
      flow = await createFlow({ nameEn: 'Perf Org' });
      emptyGrantId = (await createGrant(flow.tenant)).id;
      const budgetLineIds: string[] = [];
      for (let i = 1; i <= BUDGET_LINES; i++) {
        const { id } = await createBudgetLine(flow.tenant, flow.grantId, {
          code: `P${String(i).padStart(3, '0')}`,
          budgetAmount: '100000.00',
        });
        budgetLineIds.push(id);
      }
      await seedApprovedPrs(flow.tenant, flow.requester.user, {
        grantId: flow.grantId,
        budgetLineIds,
        count: PRS,
        linesPerPr: LINES_PER_PR,
        prDate: flow.prDate,
      });
    }, 600_000);

    afterAll(async () => {
      await cleanupTestData();
      await closeOwnerDb();
    });

    it(`GET /reports/budget-status < 2 s with ${PRS} PRs`, async () => {
      const report = (grantId: string) => () =>
        as(flow.finance.token).get(`/reports/budget-status?grantId=${grantId}`).expect(200);
      const sample = async (grantId: string) => {
        await report(grantId)(); // warm-up (JWKS, connection pool)
        const runs = [];
        for (let i = 0; i < 3; i++) runs.push(await timed(report(grantId)));
        return runs;
      };

      const runs = await sample(flow.grantId);
      const worst = Math.max(...runs.map((r) => r.ms));
      console.info(`[perf] budget report: ${runs.map((r) => r.ms.toFixed(0)).join(', ')} ms`);

      const body = runs[0]!.result.body;
      expect(body.lines).toHaveLength(BUDGET_LINES + 1);
      // every bulk PR commits 10 × 1.00 USD to one of the 50 lines
      expect(body.totals.committed).toBe((PRS * LINES_PER_PR).toFixed(2));
      if (isLocalDb()) {
        expect(worst).toBeLessThan(2000);
      } else {
        const baseline = Math.min(...(await sample(emptyGrantId)).map((r) => r.ms));
        console.info(`[perf] empty-grant baseline: ${baseline.toFixed(0)} ms`);
        expect(worst - baseline).toBeLessThan(2000);
      }
    });
  }
);
