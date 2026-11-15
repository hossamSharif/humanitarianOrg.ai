// T084 — step eligibility (US3-2, FR-020, FR-032, Business Rules 5–6).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ApprovalRoutingService,
  type Candidate,
  type EligibilityPr,
  type EligibilityStep,
} from '../../src/services/approval-routing.service';
import { KST_OFFICE_ID, MAD_OFFICE_ID, buildPr } from './helpers/builders';
import {
  InMemoryRoutingStore,
  buildCandidate,
  buildRole,
  toRuleLike,
} from './helpers/routing-store';

function setup() {
  const store = new InMemoryRoutingStore();
  const financeRole = buildRole('finance_checker');
  const approverRole = buildRole('approver');
  // holds a "final approval" role that lacks pr:approve
  const viewerRole = buildRole('viewer');
  store.roles = [financeRole, approverRole, viewerRole];
  const service = new ApprovalRoutingService(store);

  const fixture = buildPr({ status: 'pending_finance_check', submissionCycle: 1 });
  const pr: EligibilityPr = {
    id: fixture.id,
    requesterId: fixture.requesterId,
    requestingOfficeId: fixture.requestingOfficeId,
  };
  const step = (overrides: Partial<EligibilityStep> = {}): EligibilityStep => ({
    cycle: 1,
    stepOrder: 2,
    kind: 'final_approval',
    requiredRoleId: approverRole.id,
    assignedUserId: null,
    ...overrides,
  });
  const member = (overrides: Partial<Candidate> = {}) => {
    const m = buildCandidate({ roleIds: [approverRole.id], ...overrides });
    store.members.push(m);
    return m;
  };
  const sign = (userId: string, stepOrder: number, cycle: number, action = 'approve') => {
    const list = store.signatures.get(pr.id!) ?? [];
    list.push({ userId, action, cycle, stepOrder });
    store.signatures.set(pr.id!, list);
  };
  return { store, service, pr, step, member, sign, financeRole, approverRole, viewerRole };
}

describe('eligibility', () => {
  it('holding the step role with its permission and office access is eligible', async () => {
    const { service, pr, step, member } = setup();
    const approver = member();
    expect(await service.isEligible(approver.userId, step(), pr)).toBe(true);
  });

  it('requires the step’s role, not just any role with the permission', async () => {
    const { service, pr, step, member, financeRole } = setup();
    const other = member({ roleIds: [financeRole.id] });
    expect(await service.isEligible(other.userId, step(), pr)).toBe(false);
  });

  it('the role must grant the step kind’s permission', async () => {
    const { service, pr, step, member, viewerRole, financeRole } = setup();
    const viewer = member({ roleIds: [viewerRole.id] });
    expect(
      await service.isEligible(viewer.userId, step({ requiredRoleId: viewerRole.id }), pr)
    ).toBe(false);
    // finance_check needs pr:finance_check; the finance role has it, the approver role does not
    const checker = member({ roleIds: [financeRole.id] });
    const financeStep = step({
      stepOrder: 1,
      kind: 'finance_check',
      requiredRoleId: financeRole.id,
    });
    expect(await service.isEligible(checker.userId, financeStep, pr)).toBe(true);
  });

  it('needs office access to the requesting office, or org-wide access', async () => {
    const { service, pr, step, member } = setup();
    const kosti = member({ officeIds: [KST_OFFICE_ID] });
    const orgWide = member({ officeIds: [], orgWideAccess: true });
    expect(await service.isEligible(kosti.userId, step(), pr)).toBe(false);
    expect(await service.isEligible(orgWide.userId, step(), pr)).toBe(true);
    expect(pr.requestingOfficeId).toBe(MAD_OFFICE_ID);
  });

  it('the PR creator is never eligible, whatever roles they hold (Business Rule 5)', async () => {
    const { service, pr, step, member, financeRole, approverRole } = setup();
    member({ userId: pr.requesterId!, roleIds: [financeRole.id, approverRole.id] });
    expect(await service.isEligible(pr.requesterId!, step(), pr)).toBe(false);
  });

  it('suspended and invited members are not eligible', async () => {
    const { service, pr, step, member } = setup();
    const suspended = member({ status: 'suspended' });
    const invited = member({ status: 'invited' });
    expect(await service.isEligible(suspended.userId, step(), pr)).toBe(false);
    expect(await service.isEligible(invited.userId, step(), pr)).toBe(false);
  });

  it('who signed a different step of the PR, in any cycle, is not eligible (Business Rule 6)', async () => {
    const { service, pr, step, member, sign, financeRole, approverRole } = setup();
    const both = member({ roleIds: [financeRole.id, approverRole.id] });
    sign(both.userId, 1, 1);
    expect(await service.isEligible(both.userId, step({ cycle: 1 }), pr)).toBe(false);
    // still barred in a later cycle, after a Return
    expect(await service.isEligible(both.userId, step({ cycle: 2 }), pr)).toBe(false);
  });

  it('re-signing the same step after a Return is allowed, but not twice in one cycle (FR-032)', async () => {
    const { service, pr, step, member, sign } = setup();
    const approver = member();
    sign(approver.userId, 2, 1);
    expect(await service.isEligible(approver.userId, step({ cycle: 1 }), pr)).toBe(false);
    expect(await service.isEligible(approver.userId, step({ cycle: 2 }), pr)).toBe(true);
  });

  it('non-approve actions (reject, return) do not bar a user', async () => {
    const { service, pr, step, member, sign } = setup();
    const approver = member();
    sign(approver.userId, 1, 1, 'return');
    expect(await service.isEligible(approver.userId, step({ cycle: 2 }), pr)).toBe(true);
  });

  it('an assigned step admits only the assignee', async () => {
    const { service, pr, step, member } = setup();
    const a = member();
    const b = member();
    const assigned = step({ assignedUserId: b.userId });
    expect(await service.isEligible(a.userId, assigned, pr)).toBe(false);
    expect(await service.isEligible(b.userId, assigned, pr)).toBe(true);
    expect((await service.eligibleUsers(assigned, pr)).map((c) => c.userId)).toEqual([b.userId]);
  });
});

describe('NO_ELIGIBLE_APPROVER (US3-2, FR-020)', () => {
  it('names the step, role and rule with nobody to sign', async () => {
    const { store, service, pr, member, financeRole, approverRole } = setup();
    const r = toRuleLike({
      id: randomUUID(),
      tenantId: 't',
      docType: 'PR',
      officeId: null,
      name: 'Default',
      isActive: true,
      steps: [
        {
          id: randomUUID(),
          stepOrder: 1,
          kind: 'finance_check',
          roleId: financeRole.id,
          minAmount: null,
          maxAmount: null,
        },
        {
          id: randomUUID(),
          stepOrder: 2,
          kind: 'final_approval',
          roleId: approverRole.id,
          minAmount: null,
          maxAmount: null,
        },
      ],
    });
    store.rules = [r];
    member({ roleIds: [financeRole.id] });
    // the only approver is the requester
    member({ userId: pr.requesterId! });

    const route = await service.resolveRoute(MAD_OFFICE_ID, '100');
    expect(await service.eligibleCounts(route, pr, 1)).toEqual([1, 0]);
    await expect(service.assertRouteEligible(route, pr, 1)).rejects.toMatchObject({
      code: 'NO_ELIGIBLE_APPROVER',
      status: 422,
      details: {
        stepOrder: 2,
        kind: 'final_approval',
        roleId: approverRole.id,
        roleName: 'Approver',
        ruleId: r.id,
      },
    });
  });

  it('passes when every step has someone', async () => {
    const { store, service, pr, member, financeRole, approverRole } = setup();
    store.rules = [
      {
        id: randomUUID(),
        name: 'Default',
        officeId: null,
        isActive: true,
        steps: [
          {
            id: randomUUID(),
            stepOrder: 1,
            kind: 'finance_check',
            roleId: financeRole.id,
            minAmount: null,
            maxAmount: null,
          },
          {
            id: randomUUID(),
            stepOrder: 2,
            kind: 'final_approval',
            roleId: approverRole.id,
            minAmount: null,
            maxAmount: null,
          },
        ],
      },
    ];
    member({ roleIds: [financeRole.id] });
    member();
    const route = await service.resolveRoute(MAD_OFFICE_ID, '100');
    await expect(service.assertRouteEligible(route, pr, 1)).resolves.toBeUndefined();
  });
});
