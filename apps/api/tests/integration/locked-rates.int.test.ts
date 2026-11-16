// T120 — rates are locked at submission (Business Rule 11, FR-028, US2-1): an SDG PR on a USD
// grant keeps its grant-currency amount, DoA amount and committed amount through final approval
// even after a newer rate is entered; a Return + resubmit locks the newer rate.
import { addDays } from '@ngo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestData, createRate } from './helpers/factories';
import { as } from './helpers/http';
import { actOnStep, createFlow, currentStep, submitPr, type Flow } from './helpers/pr-flow';
import {
  closeOwnerDb,
  ensureMigrated,
  integrationEnabled,
  ownerDb,
  truncateTenantTables,
} from './helpers/setup';

// long HTTP flows: ~0.3 s per round trip to a remote dev database
describe.runIf(integrationEnabled)('Locked rates (US5)', { timeout: 180_000 }, () => {
  let flow: Flow;
  let approvedPr: { id: string };
  let returnedPr: { id: string };

  const amounts = async (prId: string) => {
    const [pr] = await ownerDb()<
      { doa_amount: string; total_grant_currency: string; grant_rate_to_base: string }[]
    >`
      select doa_amount::text, total_grant_currency::text, grant_rate_to_base::text
      from public.purchase_requisition where id = ${prId}`;
    const lines = await ownerDb()<{ amount_grant: string }[]>`
      select amount_grant::text from public.pr_line where pr_id = ${prId} order by line_no`;
    const commitments = await ownerDb()<{ cycle: number; amount: string; status: string }[]>`
      select cycle, amount::text, status from public.budget_commitment
      where pr_id = ${prId} order by cycle`;
    return { pr: pr!, lines: lines.map((l) => l.amount_grant), commitments };
  };

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    flow = await createFlow({ nameEn: 'Locked Rates Org' });
    // both submitted at 600 SDG/USD: 870,710.00 / 600 = 1,451.18
    approvedPr = await submitPr(flow);
    returnedPr = await submitPr(flow);
    // a newer rate, still on or before the PR date
    await createRate(flow.tenant, {
      currency: 'USD',
      rateToBase: '700',
      rateDate: addDays(flow.prDate, -1),
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  it('final approval commits the amounts locked at submission (US2-1)', async () => {
    expect((await actOnStep(flow.finance.token, approvedPr.id, 'approve')).status).toBe(200);
    expect((await actOnStep(flow.approver.token, approvedPr.id, 'approve')).body.status).toBe(
      'approved'
    );
    const { pr, lines, commitments } = await amounts(approvedPr.id);
    expect(pr).toEqual({
      doa_amount: '1451.18',
      total_grant_currency: '1451.18',
      grant_rate_to_base: '600.000000',
    });
    expect(lines).toEqual(['1451.18']);
    expect(commitments).toEqual([{ cycle: 1, amount: '1451.18', status: 'committed' }]);
  });

  it('after Return + resubmit the newer rate is locked (FR-028)', async () => {
    expect((await actOnStep(flow.finance.token, returnedPr.id, 'return')).status).toBe(200);
    const { version } = await currentStep(flow.requester.token, returnedPr.id);
    const res = await as(flow.requester.token).post(`/prs/${returnedPr.id}/submit`, {
      expectedVersion: version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // 870,710.00 / 700 = 1,243.871… → 1,243.87
    const { pr, lines, commitments } = await amounts(returnedPr.id);
    expect(pr).toMatchObject({ total_grant_currency: '1243.87', grant_rate_to_base: '700.000000' });
    expect(lines).toEqual(['1243.87']);
    expect(commitments).toEqual([
      { cycle: 1, amount: '1451.18', status: 'released' },
      { cycle: 2, amount: '1243.87', status: 'reserved' },
    ]);
  });
});
