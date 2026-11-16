// T144 — "My tasks" and in-app notifications (US8-1, FR-047, FR-048, research R16): a PR waiting
// on a step appears in the eligible users' `GET /prs/my-tasks` with a `pr_action_required`
// notification; the creator never sees their own PR there even when they hold the step's role;
// the requester is told about approve / reject / return; read state is per user and nobody can
// read or mark another user's notifications.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestData } from './helpers/factories';
import { as } from './helpers/http';
import { actOnStep, createFlow, submitPr, type Flow } from './helpers/pr-flow';
import {
  closeOwnerDb,
  ensureMigrated,
  integrationEnabled,
  ownerDb,
  truncateTenantTables,
} from './helpers/setup';

interface Task {
  prId: string;
  number: string;
  stepKind: string;
  stepOrder: number;
  waitingSince: string;
}

interface Notification {
  id: string;
  kind: string;
  prId: string;
  params: { number: string | null; stepKind: string | null; actorName: string | null };
  readAt: string | null;
}

describe.runIf(integrationEnabled)('My tasks and notifications (US8)', { timeout: 240_000 }, () => {
  let flow: Flow;

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    flow = await createFlow({ nameEn: 'Tasks Org' });
    // the requester also holds the finance-check role: still never their own task (FR-020)
    await ownerDb()`
      insert into public.user_role (tenant_id, membership_id, role_id)
      values (${flow.tenant.id}, ${flow.requester.user.membershipId},
              ${flow.tenant.roles.finance_checker})`;
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  const tasks = async (token: string) => {
    const res = await as(token).get('/prs/my-tasks');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as Task[];
  };
  const notifications = async (token: string, query = '') => {
    const res = await as(token).get(`/notifications${query}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as { data: Notification[]; unreadCount: number };
  };
  const forPr = (list: { data: Notification[] }, prId: string) =>
    list.data.filter((n) => n.prId === prId);

  it('a pending step is in the eligible user’s My tasks with a notification (US8-1)', async () => {
    const { id, number } = await submitPr(flow);

    const financeTasks = await tasks(flow.finance.token);
    expect(financeTasks).toEqual([
      expect.objectContaining({ prId: id, number, stepKind: 'finance_check', stepOrder: 1 }),
    ]);
    expect(Number.isNaN(Date.parse(financeTasks[0]!.waitingSince))).toBe(false);
    expect(await tasks(flow.approver.token)).toEqual([]);
    // creator, although holding the finance-check role
    expect(await tasks(flow.requester.token)).toEqual([]);

    expect(forPr(await notifications(flow.finance.token), id)).toEqual([
      expect.objectContaining({
        kind: 'pr_action_required',
        params: expect.objectContaining({ number, stepKind: 'finance_check' }),
        readAt: null,
      }),
    ]);

    // finance signs → the approver's task and notification; finance's task is gone
    expect((await actOnStep(flow.finance.token, id, 'approve')).status).toBe(200);
    expect(await tasks(flow.finance.token)).toEqual([]);
    expect(await tasks(flow.approver.token)).toEqual([
      expect.objectContaining({ prId: id, stepKind: 'final_approval', stepOrder: 2 }),
    ]);
    expect(forPr(await notifications(flow.approver.token), id)).toEqual([
      expect.objectContaining({
        kind: 'pr_action_required',
        params: expect.objectContaining({ stepKind: 'final_approval' }),
      }),
    ]);

    expect((await actOnStep(flow.approver.token, id, 'approve')).status).toBe(200);
    expect(await tasks(flow.approver.token)).toEqual([]);
    expect(forPr(await notifications(flow.requester.token), id)).toEqual([
      expect.objectContaining({ kind: 'pr_approved', params: expect.objectContaining({ number }) }),
    ]);
  });

  it('the requester is notified of reject and return', async () => {
    const rejected = await submitPr(flow);
    expect((await actOnStep(flow.finance.token, rejected.id, 'reject')).status).toBe(200);
    const returned = await submitPr(flow);
    expect((await actOnStep(flow.finance.token, returned.id, 'return')).status).toBe(200);

    const mine = await notifications(flow.requester.token);
    expect(forPr(mine, rejected.id).map((n) => n.kind)).toEqual(['pr_rejected']);
    expect(forPr(mine, returned.id).map((n) => n.kind)).toEqual(['pr_returned']);
    expect(await tasks(flow.finance.token)).toEqual([]);
  });

  it('unread count, mark one read, mark all read', async () => {
    const before = await notifications(flow.requester.token);
    expect(before.unreadCount).toBe(3);
    expect(before.data.every((n) => n.readAt === null)).toBe(true);

    const first = before.data[0]!;
    const read = await as(flow.requester.token).post(`/notifications/${first.id}/read`);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body.readAt).not.toBeNull();

    const unread = await notifications(flow.requester.token, '?unread=true');
    expect(unread.unreadCount).toBe(2);
    expect(unread.data.map((n) => n.id)).not.toContain(first.id);

    const all = await as(flow.requester.token).post('/notifications/read-all');
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body).toEqual({ updated: 2 });
    expect((await notifications(flow.requester.token)).unreadCount).toBe(0);
  });

  it('users never read or mark others’ notifications', async () => {
    const { data } = await notifications(flow.finance.token);
    const financeIds = new Set(data.map((n) => n.id));
    const requesterOwn = (await notifications(flow.requester.token)).data;
    expect(requesterOwn.some((n) => financeIds.has(n.id))).toBe(false);

    const foreign = data.find((n) => n.readAt === null)!;
    const res = await as(flow.requester.token).post(`/notifications/${foreign.id}/read`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');

    await as(flow.requester.token).post('/notifications/read-all').expect(200);
    const [row] = await ownerDb()<{ read_at: string | null }[]>`
      select read_at from public.notification where id = ${foreign.id}`;
    expect(row?.read_at).toBeNull();
  });
});
