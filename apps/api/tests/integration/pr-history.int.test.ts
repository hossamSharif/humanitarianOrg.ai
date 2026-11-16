// T145 — PR history timeline (FR-044, SC-002): `GET /prs/:id/history` returns ordered entries
// `{ at, actor { nameAr, nameEn, position }, action, fromState, toState, comment, changes }`
// covering create, draft edits, submit, budget-line change, reassign, approve, return, resubmit
// and cancel. Autosaves that change nothing write nothing (20 saves with one real line change →
// one pr_line audit row), and a burst of draft edits within 10 minutes is one timeline entry.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestData, createBudgetLine, createUser, tokenFor } from './helpers/factories';
import { as } from './helpers/http';
import {
  actOnStep,
  createFlow,
  currentStep,
  detail,
  type Flow,
  type FlowUser,
} from './helpers/pr-flow';
import {
  closeOwnerDb,
  ensureMigrated,
  integrationEnabled,
  ownerDb,
  truncateTenantTables,
} from './helpers/setup';

interface Entry {
  at: string;
  actor: { userId: string | null; nameAr: string; nameEn: string; position: string | null };
  action: string;
  fromState: string | null;
  toState: string | null;
  comment: string | null;
  stepKind: string | null;
  changes: { field: string; lineNo?: number; from: string | null; to: string | null }[];
}

describe.runIf(integrationEnabled)('PR history (US8)', { timeout: 240_000 }, () => {
  let flow: Flow;
  let finance2: FlowUser;
  let secondLineId: string;
  let prId: string;
  let history: Entry[];
  let lineAuditRows: number;

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    flow = await createFlow({ nameEn: 'History Org' });
    const user = await createUser(flow.tenant, { roles: ['finance_checker'] });
    finance2 = { user, token: await tokenFor(user) };
    secondLineId = (await createBudgetLine(flow.tenant, flow.grantId, { code: '20101' })).id;

    const mad = flow.tenant.offices.MAD!;
    const header = {
      prDate: flow.prDate,
      requestingOfficeId: mad,
      grantId: flow.grantId,
      deliverToOfficeId: mad,
      prType: 'goods' as const,
      purpose: 'Hygiene',
    };
    const line = {
      description: 'Jerrycan 20 L',
      quantity: '10',
      unitId: flow.tenant.unitId,
      unitCost: '87071.00',
      currency: 'SDG',
      budgetLineId: flow.budgetLineId,
      locationOfficeId: mad,
    };
    const created = await as(flow.requester.token).post('/prs', { header, lines: [line] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    prId = created.body.id;
    let version: number = created.body.version;
    const lineId = (await detail(flow.requester.token, prId)).lines[0].id as string;

    // 20 autosaves: the 10th changes the quantity, the 15th the purpose; the rest change nothing
    for (let i = 1; i <= 20; i++) {
      const res = await as(flow.requester.token).patch(`/prs/${prId}`, {
        expectedVersion: version,
        header: { ...header, purpose: i >= 15 ? 'Hygiene kits for Madani' : header.purpose },
        lines: [{ ...line, id: lineId, quantity: i >= 10 ? '12' : '10' }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.changed).toBe(i === 10 || i === 15);
      version = res.body.version;
    }
    const [row] = await ownerDb()<{ count: number }[]>`
      select count(*)::int as count from public.audit_history
      where pr_id = ${prId} and table_name = 'pr_line' and action = 'update'`;
    lineAuditRows = row!.count;

    const submitted = await as(flow.requester.token).post(`/prs/${prId}/submit`, {
      expectedVersion: version,
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);

    let step = await currentStep(flow.finance.token, prId);
    const moved = await as(flow.finance.token).post(`/prs/${prId}/lines/${lineId}/budget-line`, {
      expectedVersion: step.version,
      budgetLineId: secondLineId,
      comment: 'Charge to 20101',
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);

    step = await currentStep(flow.admin.token, prId);
    const reassigned = await as(flow.admin.token).post(
      `/prs/${prId}/steps/${step.stepId}/reassign`,
      { expectedVersion: step.version, userId: finance2.user.id, reason: 'Covering leave' }
    );
    expect(reassigned.status, JSON.stringify(reassigned.body)).toBe(200);

    expect((await actOnStep(finance2.token, prId, 'approve')).status).toBe(200);
    expect(
      (await actOnStep(flow.approver.token, prId, 'return', 'Attach a second quotation')).status
    ).toBe(200);

    let pr = await detail(flow.requester.token, prId);
    const edited = await as(flow.requester.token).patch(`/prs/${prId}`, {
      expectedVersion: pr.version,
      header: { ...header, purpose: 'Hygiene kits, two quotations attached' },
      lines: [{ ...line, id: lineId, quantity: '12', budgetLineId: secondLineId }],
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const resubmitted = await as(flow.requester.token).post(`/prs/${prId}/submit`, {
      expectedVersion: edited.body.version,
    });
    expect(resubmitted.status, JSON.stringify(resubmitted.body)).toBe(200);

    pr = await detail(flow.requester.token, prId);
    const cancelled = await as(flow.requester.token).post(`/prs/${prId}/cancel`, {
      expectedVersion: pr.version,
      reason: 'Bought from another grant',
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);

    const res = await as(flow.requester.token).get(`/prs/${prId}/history`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    history = res.body.data;
  }, 600_000);

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  it('autosaves that change nothing write no audit rows', () => {
    expect(lineAuditRows).toBe(1);
  });

  it('lists every action in order', () => {
    expect(history.map((e) => e.action)).toEqual([
      'create',
      'update',
      'submit',
      'change_budget_line',
      'reassign',
      'approve',
      'return',
      'update',
      'resubmit',
      'cancel',
    ]);
    const times = history.map((e) => Date.parse(e.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('a burst of draft edits is one entry with the combined changes', () => {
    const edit = history[1]!;
    expect(edit.actor).toMatchObject({ userId: flow.requester.user.id, nameEn: 'Test User' });
    expect(edit.changes).toEqual(
      expect.arrayContaining([
        { field: 'purpose', from: 'Hygiene', to: 'Hygiene kits for Madani' },
        expect.objectContaining({ field: 'line.quantity', lineNo: 1, to: '12.000' }),
      ])
    );
    expect(edit.changes.some((c) => c.field === 'line.lineTotal')).toBe(false);
  });

  it('workflow entries carry states, actor position and reasons', () => {
    const by = (action: string) => history.find((e) => e.action === action)!;
    expect(by('create')).toMatchObject({ fromState: null, toState: 'draft' });
    expect(by('submit')).toMatchObject({ fromState: 'draft', toState: 'pending_finance_check' });
    expect(by('change_budget_line')).toMatchObject({
      actor: { userId: flow.finance.user.id, position: 'Officer' },
      comment: 'Charge to 20101',
      changes: [{ field: 'line.budgetLineId', lineNo: 1, from: '10202', to: '20101' }],
    });
    expect(by('reassign')).toMatchObject({
      actor: { userId: flow.admin.user.id },
      comment: 'Covering leave',
      stepKind: 'finance_check',
    });
    expect(by('approve')).toMatchObject({
      actor: { userId: finance2.user.id, nameEn: 'Test User', position: 'Officer' },
      fromState: 'pending_finance_check',
      toState: 'pending_approval',
      stepKind: 'finance_check',
    });
    expect(by('return')).toMatchObject({
      fromState: 'pending_approval',
      toState: 'returned',
      comment: 'Attach a second quotation',
    });
    expect(by('resubmit')).toMatchObject({
      fromState: 'returned',
      toState: 'pending_finance_check',
    });
    expect(by('cancel')).toMatchObject({
      fromState: 'pending_finance_check',
      toState: 'cancelled',
      comment: 'Bought from another grant',
    });
    expect(history[7]!.changes).toEqual(
      expect.arrayContaining([
        {
          field: 'purpose',
          from: 'Hygiene kits for Madani',
          to: 'Hygiene kits, two quotations attached',
        },
      ])
    );
  });
});
