// T130 — cancelling an approved PR through HTTP: the budget line's Committed drops by the PR's
// amount, the PR stays readable as Cancelled with its number, the next submission in the same
// office and year takes the following number, and a cancelled PR cannot be deleted (US6-3,
// SC-007, FR-042, FR-043). The `GET /prs` list arrives with US8 (T149) and is covered there.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestData } from './helpers/factories';
import { as } from './helpers/http';
import { actOnStep, createFlow, detail, submitPr, type Flow } from './helpers/pr-flow';
import {
  closeOwnerDb,
  ensureMigrated,
  integrationEnabled,
  truncateTenantTables,
} from './helpers/setup';

const sequenceOf = (number: string) => Number(number.match(/(\d+)$/)![1]);

describe.runIf(integrationEnabled)('PR cancel (US6)', { timeout: 180_000 }, () => {
  let flow: Flow;

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    flow = await createFlow({ nameEn: 'Cancel Org' });
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  const committed = async () => {
    const res = await as(flow.finance.token).get(`/budget-lines/${flow.budgetLineId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as { committed: string; reserved: string; available: string };
  };

  const cancel = async (token: string, prId: string, reason = 'Activity postponed') => {
    const { version } = await detail(flow.requester.token, prId);
    return as(token).post(`/prs/${prId}/cancel`, { expectedVersion: version, reason });
  };

  it('cancelling an approved PR releases its commitment and keeps it visible', async () => {
    const { id, number } = await submitPr(flow);
    expect((await actOnStep(flow.finance.token, id, 'approve')).status).toBe(200);
    expect((await actOnStep(flow.approver.token, id, 'approve')).status).toBe(200);
    expect(await committed()).toMatchObject({ committed: '1451.18', reserved: '0.00' });

    // the requester lacks pr:cancel_approved
    const refused = await cancel(flow.requester.token, id);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('FORBIDDEN');
    const before = await detail(flow.requester.token, id);
    expect(before.availableActions).not.toContain('cancel');
    expect((await detail(flow.admin.token, id)).availableActions).toContain('cancel');

    const res = await cancel(flow.admin.token, id, 'Donor withdrew funding');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id, status: 'cancelled', currentStepOrder: null });

    expect(await committed()).toMatchObject({
      committed: '0.00',
      reserved: '0.00',
      available: '10000.00',
    });
    const after = await detail(flow.requester.token, id);
    expect(after).toMatchObject({
      status: 'cancelled',
      number,
      cancelReason: 'Donor withdrew funding',
    });
    expect(after.reservations).toEqual([expect.objectContaining({ status: 'released' })]);
    expect(after.actions.at(-1)).toMatchObject({
      action: 'cancel',
      comment: 'Donor withdrew funding',
    });
    expect(after.availableActions).toEqual([]);

    // a second cancel is refused
    const again = await cancel(flow.admin.token, id);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('INVALID_STATE');

    // cancelled PRs are never deleted (FR-043)
    const del = await as(flow.requester.token).delete(`/prs/${id}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('INVALID_STATE');
    expect((await detail(flow.requester.token, id)).status).toBe('cancelled');
  });

  it('the requester cancels a pending PR; its number is never reused (SC-007)', async () => {
    const first = await submitPr(flow);
    const reservedBefore = (await committed()).reserved;
    expect(reservedBefore).toBe('1451.18');

    const res = await cancel(flow.requester.token, first.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await committed()).reserved).toBe('0.00');
    expect(
      (await detail(flow.requester.token, first.id)).steps.map((s: { status: string }) => s.status)
    ).toEqual(['cancelled', 'cancelled']);

    const next = await submitPr(flow);
    expect(next.number).not.toBe(first.number);
    expect(sequenceOf(next.number)).toBe(sequenceOf(first.number) + 1);
  });

  it('a cancel without a reason → 400 VALIDATION_ERROR', async () => {
    const { id } = await submitPr(flow);
    const { version } = await detail(flow.requester.token, id);
    const res = await as(flow.requester.token).post(`/prs/${id}/cancel`, {
      expectedVersion: version,
      reason: '  ',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
