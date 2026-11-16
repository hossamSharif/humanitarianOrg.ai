// T117 — the PR state machine (data-model §6) through HTTP: every US5 transition, and each action a
// status does not admit answered with 409 INVALID_STATE; an approved PR can be neither edited nor
// deleted (Business Rule 7, FR-040). Cancel is covered with US6.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestData, createDraftPr } from './helpers/factories';
import { as } from './helpers/http';
import { actOnStep, createFlow, currentStep, detail, submitPr, type Flow } from './helpers/pr-flow';
import {
  closeOwnerDb,
  ensureMigrated,
  integrationEnabled,
  truncateTenantTables,
} from './helpers/setup';

// long HTTP flows: ~0.3 s per round trip to a remote dev database
describe.runIf(integrationEnabled)('PR state machine (US5)', { timeout: 180_000 }, () => {
  let flow: Flow;

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    flow = await createFlow({ nameEn: 'State Machine Org' });
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  /** Every step action on the PR's last step must be refused with 409 INVALID_STATE. */
  async function expectStepActionsRefused(prId: string, token: string) {
    const pr = await detail(token, prId);
    const stepId = pr.steps.at(-1).id;
    for (const [path, body] of [
      ['approve', { expectedVersion: pr.version, stepId }],
      ['reject', { expectedVersion: pr.version, stepId, reason: 'x' }],
      ['return', { expectedVersion: pr.version, stepId, reason: 'x' }],
    ] as const) {
      const res = await as(token).post(`/prs/${prId}/${path}`, body);
      expect(res.status, `${path} → ${JSON.stringify(res.body)}`).toBe(409);
      expect(res.body.code).toBe('INVALID_STATE');
    }
  }

  it('pending_finance_check → approve → pending_approval → approve → approved', async () => {
    const { id } = await submitPr(flow);

    // a draft-only action is refused while pending
    const resubmit = await as(flow.requester.token).post(`/prs/${id}/submit`, {
      expectedVersion: (await detail(flow.requester.token, id)).version,
    });
    expect(resubmit.status).toBe(409);
    expect(resubmit.body.code).toBe('INVALID_STATE');

    const finance = await actOnStep(flow.finance.token, id, 'approve');
    expect(finance.status, JSON.stringify(finance.body)).toBe(200);
    expect(finance.body).toMatchObject({ status: 'pending_approval', currentStepOrder: 2 });

    // change_budget_line belongs to the finance check only
    const pr = await detail(flow.approver.token, id);
    const move = await as(flow.finance.token).post(
      `/prs/${id}/lines/${pr.lines[0].id}/budget-line`,
      {
        expectedVersion: pr.version,
        budgetLineId: flow.budgetLineId,
      }
    );
    expect(move.status).toBe(409);
    expect(move.body.code).toBe('INVALID_STATE');

    const final = await actOnStep(flow.approver.token, id, 'approve');
    expect(final.status, JSON.stringify(final.body)).toBe(200);
    expect(final.body).toMatchObject({ status: 'approved', currentStepOrder: null });

    const approved = await detail(flow.requester.token, id);
    expect(approved.status).toBe('approved');
    expect(approved.approvedAt).not.toBeNull();
    expect(approved.steps.map((s: { status: string }) => s.status)).toEqual([
      'approved',
      'approved',
    ]);
    expect(approved.availableActions).toEqual([]);
  });

  it('an approved PR admits no step action, no edit and no delete (Business Rule 7, FR-040)', async () => {
    const { id } = await submitPr(flow);
    await actOnStep(flow.finance.token, id, 'approve');
    await actOnStep(flow.approver.token, id, 'approve');

    await expectStepActionsRefused(id, flow.approver.token);
    const pr = await detail(flow.requester.token, id);
    const patch = await as(flow.requester.token).patch(`/prs/${id}`, {
      expectedVersion: pr.version,
      header: {},
      lines: [],
    });
    expect(patch.status).toBe(409);
    expect(patch.body.code).toBe('INVALID_STATE');
    const del = await as(flow.requester.token).delete(`/prs/${id}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('INVALID_STATE');
    const submit = await as(flow.requester.token).post(`/prs/${id}/submit`, {
      expectedVersion: pr.version,
    });
    expect(submit.status).toBe(409);
  });

  it('pending_finance_check → reject → rejected (final)', async () => {
    const { id } = await submitPr(flow);
    const res = await actOnStep(flow.finance.token, id, 'reject', 'Duplicate request');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('rejected');
    const pr = await detail(flow.requester.token, id);
    expect(pr).toMatchObject({ status: 'rejected', rejectReason: 'Duplicate request' });

    await expectStepActionsRefused(id, flow.finance.token);
    const submit = await as(flow.requester.token).post(`/prs/${id}/submit`, {
      expectedVersion: pr.version,
    });
    expect(submit.status).toBe(409);
    expect(submit.body.code).toBe('INVALID_STATE');
  });

  it('pending_approval → reject → rejected', async () => {
    const { id } = await submitPr(flow);
    await actOnStep(flow.finance.token, id, 'approve');
    const res = await actOnStep(flow.approver.token, id, 'reject', 'Out of scope');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('rejected');
  });

  it('pending_* → return → returned: editable by the requester, step actions refused, resubmit', async () => {
    const { id, number } = await submitPr(flow);
    await actOnStep(flow.finance.token, id, 'approve');
    const res = await actOnStep(flow.approver.token, id, 'return', 'Attach quotation');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('returned');

    await expectStepActionsRefused(id, flow.approver.token);

    const returned = await detail(flow.requester.token, id);
    expect(returned).toMatchObject({
      status: 'returned',
      returnReason: 'Attach quotation',
      number,
    });
    expect(returned.availableActions).toEqual(['update', 'submit']);
    const save = await as(flow.requester.token).patch(`/prs/${id}`, {
      expectedVersion: returned.version,
      header: {
        prDate: returned.prDate,
        requestingOfficeId: returned.requestingOfficeId,
        grantId: returned.grantId,
        deliverToOfficeId: returned.deliverToOfficeId,
        prType: returned.prType,
        purpose: 'Quotation attached',
      },
      lines: returned.lines.map((l: Record<string, unknown>) => ({
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        unitId: l.unitId,
        unitCost: l.unitCost,
        currency: l.currency,
        budgetLineId: l.budgetLineId,
        locationOfficeId: l.locationOfficeId,
      })),
    });
    expect(save.status, JSON.stringify(save.body)).toBe(200);

    const resubmit = await as(flow.requester.token).post(`/prs/${id}/submit`, {
      expectedVersion: save.body.version,
    });
    expect(resubmit.status, JSON.stringify(resubmit.body)).toBe(200);
    expect(resubmit.body).toMatchObject({ status: 'pending_finance_check', number });
    const { pr } = await currentStep(flow.finance.token, id);
    expect(pr.submissionCycle).toBe(2);
  });

  it('a draft admits no step action', async () => {
    const { id } = await submitPr(flow);
    // the steps of a draft do not exist; use a submitted PR's step id against a fresh draft
    const other = await detail(flow.finance.token, id);
    const draft = await createDraftPr(flow.tenant, flow.requester.user, {
      grantId: flow.grantId,
      budgetLineId: flow.budgetLineId,
      prDate: flow.prDate,
    });
    const res = await as(flow.finance.token).post(`/prs/${draft.id}/approve`, {
      expectedVersion: 1,
      stepId: other.steps[0].id,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_STATE');
  });
});
