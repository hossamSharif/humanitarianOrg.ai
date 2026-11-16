// US5 integration flows through HTTP: a funded tenant with the default route, submitted PRs, and
// signing / rejecting / returning the current step as a given user.
import { addDays, type SeededRoleKey } from '@ngo/shared';
import { expect } from 'vitest';
import {
  createBudgetLine,
  createDraftPr,
  createGrant,
  createPrRouting,
  createRate,
  createTenant,
  createUser,
  todayInKhartoum,
  tokenFor,
  type TestTenant,
  type TestUser,
} from './factories';
import type { Response } from 'supertest';
import { as } from './http';

export interface FlowUser {
  user: TestUser;
  token: string;
}

export interface Flow {
  tenant: TestTenant;
  grantId: string;
  budgetLineId: string;
  prDate: string;
  requester: FlowUser;
  finance: FlowUser;
  approver: FlowUser;
  admin: FlowUser;
}

/**
 * Tenant with the default route, an active USD grant in MAD (budget line 10,000.00 USD), a USD
 * rate of 600 SDG dated 5 days before today, and requester / finance / approver / admin users.
 * `requesterRoles` / `financeRoles` replace those users' roles (segregation tests).
 */
export async function createFlow(options: {
  nameEn: string;
  requesterRoles?: SeededRoleKey[];
  financeRoles?: SeededRoleKey[];
}): Promise<Flow> {
  const tenant = await createTenant({ nameEn: options.nameEn });
  await createPrRouting(tenant);
  const prDate = todayInKhartoum();
  const [requester, finance, approver, admin] = await Promise.all([
    createUser(tenant, { roles: options.requesterRoles ?? ['requester'] }),
    createUser(tenant, { roles: options.financeRoles ?? ['finance_checker'] }),
    createUser(tenant, { roles: ['approver'] }),
    createUser(tenant, { roles: ['org_admin'], orgWideAccess: true }),
  ]);
  const tokens = await Promise.all([requester, finance, approver, admin].map(tokenFor));
  const { id: grantId } = await createGrant(tenant, {
    startDate: addDays(prDate, -365),
    endDate: addDays(prDate, 365),
  });
  const { id: budgetLineId } = await createBudgetLine(tenant, grantId, {
    budgetAmount: '10000.00',
  });
  await createRate(tenant, { currency: 'USD', rateToBase: '600', rateDate: addDays(prDate, -5) });
  return {
    tenant,
    grantId,
    budgetLineId,
    prDate,
    requester: { user: requester, token: tokens[0]! },
    finance: { user: finance, token: tokens[1]! },
    approver: { user: approver, token: tokens[2]! },
    admin: { user: admin, token: tokens[3]! },
  };
}

/** A draft of 10 × 87,071.00 SDG (1,451.18 USD), submitted by the requester. */
export async function submitPr(flow: Flow): Promise<{ id: string; number: string }> {
  const { id } = await createDraftPr(flow.tenant, flow.requester.user, {
    grantId: flow.grantId,
    budgetLineId: flow.budgetLineId,
    prDate: flow.prDate,
  });
  const res = await as(flow.requester.token).post(`/prs/${id}/submit`, { expectedVersion: 1 });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { id, number: res.body.number };
}

/** GET /prs/:id as `token`. */
export async function detail(token: string, prId: string) {
  const res = await as(token).get(`/prs/${prId}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

/** The current pending step of the PR (as seen by `token`) and the PR version. */
export async function currentStep(token: string, prId: string) {
  const pr = await detail(token, prId);
  const step = pr.steps.find((s: { status: string }) => s.status === 'pending');
  return { version: pr.version as number, stepId: (step?.id ?? null) as string | null, pr };
}

/** POST approve / reject / return on the current step as `token`; returns the raw response. */
export async function actOnStep(
  token: string,
  prId: string,
  action: 'approve' | 'reject' | 'return',
  reason = 'Needs a second quotation'
): Promise<Response> {
  const { version, stepId } = await currentStep(token, prId);
  const body =
    action === 'approve'
      ? { expectedVersion: version, stepId }
      : { expectedVersion: version, stepId, reason };
  return as(token).post(`/prs/${prId}/${action}`, body);
}
