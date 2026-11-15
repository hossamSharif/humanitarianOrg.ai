// T083 — DoA routing (US3-1, US3-3) and approval rule validation (FR-019, FR-035).
import { randomUUID } from 'node:crypto';
import type { ApprovalRuleIssue } from '@ngo/shared';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/middleware/error';
import {
  ApprovalRoutingService,
  bandContains,
  pickRule,
  ruleIssues,
  validateRule,
  type RuleStepDraft,
} from '../../src/services/approval-routing.service';
import { KST_OFFICE_ID, MAD_OFFICE_ID, buildRule } from './helpers/builders';
import { InMemoryRoutingStore, toRuleLike } from './helpers/routing-store';

const FINANCE = randomUUID();
const PAM = randomUUID(); // Program Area Manager
const CD = randomUUID(); // Country Director
const REVIEWER = randomUUID();

const finance: RuleStepDraft = {
  stepOrder: 1,
  kind: 'finance_check',
  roleId: FINANCE,
  minAmount: null,
  maxAmount: null,
};

function band(roleId: string, minAmount: string | null, maxAmount: string | null): RuleStepDraft {
  return { stepOrder: 2, kind: 'final_approval', roleId, minAmount, maxAmount };
}

/** Finance check → final approval up to 5,000 → PAM, above → CD. */
const twoBands: RuleStepDraft[] = [finance, band(PAM, null, '5000.00'), band(CD, '5000.00', null)];

function reasons(steps: RuleStepDraft[]): ApprovalRuleIssue['reason'][] {
  return ruleIssues(steps).map((i) => i.reason);
}

function rule(
  steps: RuleStepDraft[],
  overrides: { officeId?: string | null; isActive?: boolean; name?: string } = {}
) {
  return toRuleLike(
    buildRule({
      officeId: overrides.officeId ?? null,
      isActive: overrides.isActive ?? true,
      name: overrides.name ?? 'Rule',
      steps: steps.map((s) => ({ id: randomUUID(), ...s })),
    })
  );
}

describe('bands: min < amount ≤ max, open top', () => {
  it('5,000 → band 1 and 7,000 → band 2 (US3-1)', async () => {
    const store = new InMemoryRoutingStore();
    store.rules = [rule(twoBands)];
    const service = new ApprovalRoutingService(store);

    const at5000 = await service.resolveRoute(MAD_OFFICE_ID, '5000.00');
    expect(at5000.steps.map((s) => s.roleId)).toEqual([FINANCE, PAM]);

    const at7000 = await service.resolveRoute(MAD_OFFICE_ID, '7000.00');
    expect(at7000.steps.map((s) => s.roleId)).toEqual([FINANCE, CD]);
    expect(at7000.steps[1]).toMatchObject({ stepOrder: 2, kind: 'final_approval' });
  });

  it('the lower bound is exclusive, the upper inclusive', () => {
    expect(bandContains({ minAmount: null, maxAmount: '5000.00' }, '5000.00')).toBe(true);
    expect(bandContains({ minAmount: '5000.00', maxAmount: null }, '5000.00')).toBe(false);
    expect(bandContains({ minAmount: '5000.00', maxAmount: null }, '5000.01')).toBe(true);
    expect(bandContains({ minAmount: null, maxAmount: null }, '99999999.99')).toBe(true);
    // the lowest band admits 0 (a PR cannot be submitted at 0, but the route is still total)
    expect(bandContains({ minAmount: '0', maxAmount: '5000.00' }, '0')).toBe(true);
  });

  it('a route has one step per step order, steps carry their rule step id', async () => {
    const store = new InMemoryRoutingStore();
    const r = rule([
      finance,
      { stepOrder: 2, kind: 'approval', roleId: REVIEWER, minAmount: null, maxAmount: null },
      { ...band(PAM, null, '5000.00'), stepOrder: 3 },
      { ...band(CD, '5000.00', null), stepOrder: 3 },
    ]);
    store.rules = [r];
    const route = await new ApprovalRoutingService(store).resolveRoute(MAD_OFFICE_ID, '120.50');
    expect(route.ruleId).toBe(r.id);
    expect(route.steps.map((s) => [s.stepOrder, s.kind, s.roleId])).toEqual([
      [1, 'finance_check', FINANCE],
      [2, 'approval', REVIEWER],
      [3, 'final_approval', PAM],
    ]);
    expect(route.steps[2]!.ruleStepId).toBe(r.steps[2]!.id);
  });
});

describe('office precedence (US3-3)', () => {
  const orgWide = rule([finance, band(CD, null, null)], { name: 'Org' });
  const madani = rule([finance, band(PAM, null, null)], { officeId: MAD_OFFICE_ID, name: 'MAD' });

  it('the office rule beats the organization-wide rule', async () => {
    const store = new InMemoryRoutingStore();
    store.rules = [orgWide, madani];
    const route = await new ApprovalRoutingService(store).resolveRoute(MAD_OFFICE_ID, '100');
    expect(route.ruleId).toBe(madani.id);
    expect(route.steps[1]!.roleId).toBe(PAM);
  });

  it('other offices fall back to the organization-wide rule', () => {
    expect(pickRule([madani, orgWide], KST_OFFICE_ID)?.id).toBe(orgWide.id);
  });

  it('an inactive office rule is skipped', () => {
    const inactive = { ...madani, isActive: false };
    expect(pickRule([inactive, orgWide], MAD_OFFICE_ID)?.id).toBe(orgWide.id);
  });

  it('no applicable rule → APPROVAL_RULE_INVALID no_rule', async () => {
    const store = new InMemoryRoutingStore();
    store.rules = [madani];
    await expect(
      new ApprovalRoutingService(store).resolveRoute(KST_OFFICE_ID, '100')
    ).rejects.toMatchObject({
      code: 'APPROVAL_RULE_INVALID',
      details: { issues: [{ reason: 'no_rule' }] },
    });
  });
});

describe('rule validation → APPROVAL_RULE_INVALID (FR-019, FR-035)', () => {
  it('accepts the seeded default and a banded rule', () => {
    expect(ruleIssues([finance, band(CD, null, null)])).toEqual([]);
    expect(ruleIssues(twoBands)).toEqual([]);
    expect(ruleIssues([finance, band(PAM, '0', '5000'), band(CD, '5000', null)])).toEqual([]);
  });

  it('throws an AppError with every issue', () => {
    let thrown: unknown;
    try {
      validateRule([band(CD, null, null)]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown).toMatchObject({ code: 'APPROVAL_RULE_INVALID', status: 422 });
    expect((thrown as AppError<'APPROVAL_RULE_INVALID'>).details?.issues.length).toBeGreaterThan(0);
  });

  it('step 1 must be finance_check', () => {
    expect(
      reasons([
        { stepOrder: 1, kind: 'approval', roleId: REVIEWER, minAmount: null, maxAmount: null },
        band(CD, null, null),
      ])
    ).toContain('first_step_not_finance_check');
    // no step 1 at all
    expect(reasons([{ ...band(CD, null, null) }])).toContain('first_step_not_finance_check');
  });

  it('a second finance_check is rejected', () => {
    expect(
      reasons([finance, { ...finance, stepOrder: 2 }, { ...band(CD, null, null), stepOrder: 3 }])
    ).toContain('multiple_finance_check');
  });

  it('the finance check cannot have a band', () => {
    expect(reasons([{ ...finance, maxAmount: '1000.00' }, band(CD, null, null)])).toContain(
      'finance_check_banded'
    );
  });

  it('the final approval must be the highest step', () => {
    expect(
      reasons([
        finance,
        band(CD, null, null),
        { stepOrder: 3, kind: 'approval', roleId: REVIEWER, minAmount: null, maxAmount: null },
      ])
    ).toContain('final_not_highest');
    expect(
      reasons([
        finance,
        { stepOrder: 2, kind: 'approval', roleId: REVIEWER, minAmount: null, maxAmount: null },
      ])
    ).toContain('missing_final_approval');
  });

  it('bands with a gap are rejected', () => {
    expect(reasons([finance, band(PAM, null, '5000'), band(CD, '6000', null)])).toContain(
      'band_gap'
    );
  });

  it('overlapping bands are rejected', () => {
    expect(reasons([finance, band(PAM, null, '5000'), band(CD, '4000', null)])).toContain(
      'band_overlap'
    );
    // two open-ended bands
    expect(reasons([finance, band(PAM, null, null), band(CD, '5000', null)])).toContain(
      'band_overlap'
    );
  });

  it('bands must start at 0', () => {
    expect(reasons([finance, band(PAM, '100', '5000'), band(CD, '5000', null)])).toContain(
      'band_not_from_zero'
    );
  });

  it('bands must end open', () => {
    expect(reasons([finance, band(PAM, null, '5000'), band(CD, '5000', '9000')])).toContain(
      'band_not_open_ended'
    );
  });

  it('a non-final step with more than one row is rejected', () => {
    const approval = (roleId: string): RuleStepDraft => ({
      stepOrder: 2,
      kind: 'approval',
      roleId,
      minAmount: null,
      maxAmount: null,
    });
    expect(
      reasons([
        finance,
        approval(REVIEWER),
        approval(PAM),
        { ...band(CD, null, null), stepOrder: 3 },
      ])
    ).toContain('non_final_multiple_rows');
  });

  it('step orders must run 1..n without gaps', () => {
    expect(reasons([finance, { ...band(CD, null, null), stepOrder: 3 }])).toContain(
      'step_order_gap'
    );
  });

  it('an empty rule is rejected', () => {
    expect(reasons([])).toEqual(['no_steps']);
  });

  it('resolving through an invalid stored rule fails instead of guessing', async () => {
    const store = new InMemoryRoutingStore();
    store.rules = [rule([finance, band(PAM, null, '5000'), band(CD, '6000', null)])];
    await expect(
      new ApprovalRoutingService(store).resolveRoute(MAD_OFFICE_ID, '5500')
    ).rejects.toMatchObject({ code: 'APPROVAL_RULE_INVALID' });
  });
});

describe('materialiseSteps', () => {
  it('step 1 pending, the rest waiting, for the given cycle', async () => {
    const written: unknown[] = [];
    const store = new InMemoryRoutingStore();
    store.rules = [rule(twoBands)];
    const service = new ApprovalRoutingService(store, async (_tx, rows) => {
      written.push(...rows);
    });
    const route = await service.resolveRoute(MAD_OFFICE_ID, '7000');
    const prId = randomUUID();
    // the writer receives the transaction; unit tests never touch it
    await service.materialiseSteps({} as never, { id: prId }, 2, route);
    expect(written).toEqual([
      expect.objectContaining({
        prId,
        cycle: 2,
        stepOrder: 1,
        status: 'pending',
        requiredRoleId: FINANCE,
      }),
      expect.objectContaining({
        prId,
        cycle: 2,
        stepOrder: 2,
        status: 'waiting',
        requiredRoleId: CD,
      }),
    ]);
  });
});
