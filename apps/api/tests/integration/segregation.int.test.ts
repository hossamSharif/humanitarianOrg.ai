// T118 — segregation of duties through HTTP and in the database: the creator never signs their
// own PR even with an approver role, a finance signer cannot sign the final step, and the unique
// index admits one `approve` row per user per cycle, again in a new cycle after a Return
// (Business Rules 5–6, FR-032).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestData } from './helpers/factories';
import { as } from './helpers/http';
import { actOnStep, createFlow, currentStep, detail, submitPr, type Flow } from './helpers/pr-flow';
import {
  closeOwnerDb,
  ensureMigrated,
  integrationEnabled,
  ownerDb,
  truncateTenantTables,
} from './helpers/setup';

// long HTTP flows: ~0.3 s per round trip to a remote dev database
describe.runIf(integrationEnabled)('Segregation of duties (US5)', { timeout: 180_000 }, () => {
  let flow: Flow;

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    // the requester may also finance-check; the finance user may also approve
    flow = await createFlow({
      nameEn: 'Segregation Org',
      requesterRoles: ['requester', 'finance_checker'],
      financeRoles: ['finance_checker', 'approver'],
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  it('the creator with a signing role gets 403 SEGREGATION_OF_DUTIES and no approve action', async () => {
    const { id } = await submitPr(flow);
    const pr = await detail(flow.requester.token, id);
    expect(pr.steps[0].canApprove).toBe(false);
    expect(pr.availableActions).not.toContain('approve');

    const res = await actOnStep(flow.requester.token, id, 'approve');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SEGREGATION_OF_DUTIES');
  });

  it('the finance signer cannot sign the final step', async () => {
    const { id } = await submitPr(flow);
    expect((await actOnStep(flow.finance.token, id, 'approve')).status).toBe(200);

    const pr = await detail(flow.finance.token, id);
    expect(pr.steps[1].canApprove).toBe(false);
    const res = await actOnStep(flow.finance.token, id, 'approve');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SEGREGATION_OF_DUTIES');

    expect((await actOnStep(flow.approver.token, id, 'approve')).body.status).toBe('approved');
  });

  it('the database admits one signature per user per cycle, and one more in a new cycle', async () => {
    const { id } = await submitPr(flow);
    expect((await actOnStep(flow.finance.token, id, 'approve')).status).toBe(200);
    const sql = ownerDb();
    const signature = (cycle: number) => sql`
      insert into public.approval_action
        (tenant_id, pr_id, cycle, step_order, action, user_id, user_name)
      values (${flow.tenant.id}, ${id}, ${cycle}, 1, 'approve', ${flow.finance.user.id}, 'Test User')`;

    await expect(signature(1)).rejects.toMatchObject({ code: '23505' });

    // Return at the final step, resubmit: the finance checker signs step 1 again in cycle 2
    expect((await actOnStep(flow.approver.token, id, 'return')).status).toBe(200);
    const { version } = await currentStep(flow.requester.token, id);
    expect(
      (await as(flow.requester.token).post(`/prs/${id}/submit`, { expectedVersion: version }))
        .status
    ).toBe(200);
    const again = await actOnStep(flow.finance.token, id, 'approve');
    expect(again.status, JSON.stringify(again.body)).toBe(200);

    const rows = await sql<{ cycle: number; step_order: number }[]>`
      select cycle, step_order from public.approval_action
      where pr_id = ${id} and action = 'approve' and user_id = ${flow.finance.user.id}
      order by cycle`;
    expect(rows).toEqual([
      { cycle: 1, step_order: 1 },
      { cycle: 2, step_order: 1 },
    ]);
  });
});
