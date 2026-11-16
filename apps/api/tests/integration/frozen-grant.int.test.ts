// T119 — a suspended grant freezes its pending PRs (FR-022): the status change first asks for
// confirmation with the pending count; approval is blocked with 422 GRANT_NOT_ACTIVE while the
// reservation stays; return and reject still work and release it; reactivating unfreezes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestData } from './helpers/factories';
import { as } from './helpers/http';
import { actOnStep, createFlow, detail, submitPr, type Flow } from './helpers/pr-flow';
import {
  closeOwnerDb,
  ensureMigrated,
  integrationEnabled,
  ownerDb,
  truncateTenantTables,
} from './helpers/setup';

// long HTTP flows: ~0.3 s per round trip to a remote dev database
describe.runIf(integrationEnabled)('Frozen grant (US5, FR-022)', { timeout: 180_000 }, () => {
  let flow: Flow;
  let prs: { id: string }[];

  const commitmentStatus = async (prId: string) =>
    (
      await ownerDb()<{ status: string; release_reason: string | null }[]>`
        select status, release_reason from public.budget_commitment where pr_id = ${prId}`
    ).map((r) => [r.status, r.release_reason]);

  const setStatus = async (status: 'active' | 'suspended', confirmPendingCount?: number) => {
    const grant = await as(flow.admin.token).get(`/grants/${flow.grantId}`);
    expect(grant.status).toBe(200);
    return as(flow.admin.token).post(`/grants/${flow.grantId}/status`, {
      status,
      expectedVersion: grant.body.version,
      ...(confirmPendingCount === undefined ? {} : { confirmPendingCount }),
    });
  };

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    flow = await createFlow({ nameEn: 'Frozen Grant Org' });
    prs = [await submitPr(flow), await submitPr(flow), await submitPr(flow)];
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  it('suspending asks for confirmation with the pending PR count first', async () => {
    const first = await setStatus('suspended');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ requiresConfirmation: true, pendingPrCount: 3 });

    const confirmed = await setStatus('suspended', 3);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body.requiresConfirmation).toBe(false);
  });

  it('approval is blocked with 422 GRANT_NOT_ACTIVE and the reservation is kept', async () => {
    const [a] = prs;
    const pr = await detail(flow.finance.token, a!.id);
    expect(pr.grantFrozen).toBe(true);
    expect(pr.availableActions).not.toContain('approve');

    const res = await actOnStep(flow.finance.token, a!.id, 'approve');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('GRANT_NOT_ACTIVE');
    expect(await commitmentStatus(a!.id)).toEqual([['reserved', null]]);
  });

  it('return and reject remain allowed and release the reservation', async () => {
    const [a, b] = prs;
    expect((await actOnStep(flow.finance.token, a!.id, 'return')).status).toBe(200);
    expect(await commitmentStatus(a!.id)).toEqual([['released', 'returned']]);
    expect((await actOnStep(flow.finance.token, b!.id, 'reject')).status).toBe(200);
    expect(await commitmentStatus(b!.id)).toEqual([['released', 'rejected']]);
  });

  it('reactivating the grant unfreezes approval', async () => {
    // any status change with pending PRs is confirmed with their count (one still pending)
    const ask = await setStatus('active');
    expect(ask.body).toMatchObject({ requiresConfirmation: true, pendingPrCount: 1 });
    const res = await setStatus('active', 1);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.requiresConfirmation).toBe(false);
    const c = prs[2]!;
    expect((await detail(flow.finance.token, c.id)).grantFrozen).toBe(false);
    const approve = await actOnStep(flow.finance.token, c.id, 'approve');
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    expect(approve.body.status).toBe('pending_approval');
  });
});
