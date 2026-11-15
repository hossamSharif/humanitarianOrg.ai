// Approval routing (research R8): rule validation (FR-019, FR-035), route resolution by office
// and DoA amount, step eligibility (FR-020, FR-032, Business Rules 5–6) and materialising the
// resolved route as pr_approval_step rows at submission (US4). The rules themselves are pure
// functions so they can be tested without a database; the service adds the data they need.
import {
  Decimal,
  STEP_KIND_PERMISSION,
  parseAmount,
  type ApprovalRuleIssue,
  type MembershipStatus,
  type Permission,
  type StepKind,
} from '@ngo/shared';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

export interface RuleStepLike {
  id: string;
  stepOrder: number;
  kind: StepKind;
  roleId: string;
  minAmount: string | null;
  maxAmount: string | null;
}

export interface RuleLike {
  id: string;
  name: string;
  officeId: string | null;
  isActive: boolean;
  steps: RuleStepLike[];
}

export type RuleStepDraft = Omit<RuleStepLike, 'id'>;

/** One step of a resolved route; banded final approval is narrowed to the matching row. */
export interface RouteStep {
  stepOrder: number;
  kind: StepKind;
  roleId: string;
  ruleStepId: string;
  minAmount: string | null;
  maxAmount: string | null;
}

export interface Route {
  ruleId: string;
  ruleName: string;
  officeId: string | null;
  steps: RouteStep[];
}

/** A tenant member who could be asked to sign. */
export interface Candidate {
  userId: string;
  membershipId: string;
  status: MembershipStatus;
  roleIds: readonly string[];
  orgWideAccess: boolean;
  officeIds: readonly string[];
}

/** The step being acted on (a pr_approval_step row, or a route step about to become one). */
export interface EligibilityStep {
  cycle: number;
  stepOrder: number;
  kind: StepKind;
  requiredRoleId: string;
  assignedUserId: string | null;
}

/** The PR the step belongs to; `id`/`requesterId` are null for the admin route preview. */
export interface EligibilityPr {
  id: string | null;
  requesterId: string | null;
  requestingOfficeId: string;
}

/** An approval_action row of the PR (any cycle). */
export interface Signature {
  userId: string;
  action: string;
  cycle: number;
  stepOrder: number | null;
}

export interface EligibilityFacts {
  /** permissions granted by each role */
  rolePermissions: ReadonlyMap<string, readonly Permission[]>;
  signatures: readonly Signature[];
}

// ---------------------------------------------------------------------------------------------
// Rule validation
// ---------------------------------------------------------------------------------------------

const ZERO = new Decimal(0);

function lower(step: Pick<RuleStepLike, 'minAmount'>): Decimal {
  return step.minAmount === null ? ZERO : parseAmount(step.minAmount);
}

function upper(step: Pick<RuleStepLike, 'maxAmount'>): Decimal | null {
  return step.maxAmount === null ? null : parseAmount(step.maxAmount);
}

function hasBand(step: Pick<RuleStepLike, 'minAmount' | 'maxAmount'>): boolean {
  return step.minAmount !== null || step.maxAmount !== null;
}

/**
 * Every structural problem of a rule's steps (data-model §2 "approval_rule_step"):
 * step 1 is the only finance check and has no band; orders are 1..n; exactly one final-approval
 * order, the highest; its bands start at 0, are contiguous, non-overlapping and end open;
 * every other order has exactly one unbanded row.
 */
export function ruleIssues(steps: readonly RuleStepDraft[]): ApprovalRuleIssue[] {
  const issues: ApprovalRuleIssue[] = [];
  if (steps.length === 0) return [{ reason: 'no_steps' }];

  const orders = [...new Set(steps.map((s) => s.stepOrder))].sort((a, b) => a - b);
  if (orders.some((order, i) => order !== i + 1)) issues.push({ reason: 'step_order_gap' });

  const first = steps.filter((s) => s.stepOrder === 1);
  if (first.length === 0 || first.some((s) => s.kind !== 'finance_check')) {
    issues.push({ reason: 'first_step_not_finance_check', stepOrder: 1 });
  }
  const financeChecks = steps.filter((s) => s.kind === 'finance_check');
  if (financeChecks.length > 1) {
    const extra = financeChecks.find((s) => s.stepOrder !== 1) ?? financeChecks[1]!;
    issues.push({ reason: 'multiple_finance_check', stepOrder: extra.stepOrder });
  }
  for (const s of financeChecks.filter(hasBand)) {
    issues.push({ reason: 'finance_check_banded', stepOrder: s.stepOrder });
  }

  const highest = orders[orders.length - 1]!;
  const finals = steps.filter((s) => s.kind === 'final_approval');
  const finalOrders = [...new Set(finals.map((s) => s.stepOrder))];
  if (finals.length === 0) {
    issues.push({ reason: 'missing_final_approval' });
  } else if (
    finalOrders.length > 1 ||
    finalOrders[0] !== highest ||
    steps.some((s) => s.stepOrder === highest && s.kind !== 'final_approval')
  ) {
    issues.push({ reason: 'final_not_highest', stepOrder: highest });
  }

  for (const order of orders) {
    if (finals.length > 0 && order === highest) continue;
    const rows = steps.filter((s) => s.stepOrder === order);
    if (rows.length > 1) issues.push({ reason: 'non_final_multiple_rows', stepOrder: order });
    if (rows.some((s) => s.kind !== 'finance_check' && hasBand(s))) {
      issues.push({ reason: 'non_final_banded', stepOrder: order });
    }
  }

  const bands = steps
    .filter((s) => s.kind === 'final_approval' && s.stepOrder === highest)
    .sort((a, b) => lower(a).comparedTo(lower(b)));
  if (bands.length > 0) issues.push(...bandIssues(bands, highest));

  return issues;
}

function bandIssues(bands: readonly RuleStepDraft[], stepOrder: number): ApprovalRuleIssue[] {
  const issues: ApprovalRuleIssue[] = [];
  const add = (reason: ApprovalRuleIssue['reason']) => {
    if (!issues.some((i) => i.reason === reason)) issues.push({ reason, stepOrder });
  };

  if (!lower(bands[0]!).isZero()) add('band_not_from_zero');
  for (const band of bands) {
    const max = upper(band);
    if (max !== null && max.lte(lower(band))) add('band_empty');
  }
  for (let i = 1; i < bands.length; i++) {
    const prevMax = upper(bands[i - 1]!);
    const min = lower(bands[i]!);
    if (prevMax === null || min.lt(prevMax)) add('band_overlap');
    else if (min.gt(prevMax)) add('band_gap');
  }
  if (upper(bands[bands.length - 1]!) !== null) add('band_not_open_ended');
  return issues;
}

/** 422 APPROVAL_RULE_INVALID listing every issue. */
export function validateRule(steps: readonly RuleStepDraft[]): void {
  const issues = ruleIssues(steps);
  if (issues.length > 0) {
    throw new AppError('APPROVAL_RULE_INVALID', 'The approval rule is not valid', { issues });
  }
}

// ---------------------------------------------------------------------------------------------
// Route resolution
// ---------------------------------------------------------------------------------------------

/** The office's active rule if it has one, else the active organization-wide rule (US3-3). */
export function pickRule<R extends RuleLike>(rules: readonly R[], officeId: string): R | null {
  const active = rules.filter((r) => r.isActive);
  return (
    active.find((r) => r.officeId === officeId) ?? active.find((r) => r.officeId === null) ?? null
  );
}

/** `min < amount ≤ max`; null min = 0 (and the lowest band also admits 0), null max = ∞. */
export function bandContains(
  step: Pick<RuleStepLike, 'minAmount' | 'maxAmount'>,
  amount: string
): boolean {
  const value = parseAmount(amount);
  const min = lower(step);
  const max = upper(step);
  const aboveMin = min.isZero() ? value.gte(ZERO) : value.gt(min);
  return aboveMin && (max === null || value.lte(max));
}

/** One route step per step order, the final approval narrowed to the band of `amount`. */
export function routeFor(rule: RuleLike, amount: string): Route {
  validateRule(rule.steps);
  const orders = [...new Set(rule.steps.map((s) => s.stepOrder))].sort((a, b) => a - b);
  const steps = orders.map((order) => {
    const rows = rule.steps.filter((s) => s.stepOrder === order);
    // validated: non-final orders have one row; final bands cover [0, ∞) without overlap
    const row = rows.length === 1 ? rows[0]! : rows.find((s) => bandContains(s, amount))!;
    return {
      stepOrder: row.stepOrder,
      kind: row.kind,
      roleId: row.roleId,
      ruleStepId: row.id,
      minAmount: row.minAmount,
      maxAmount: row.maxAmount,
    };
  });
  return { ruleId: rule.id, ruleName: rule.name, officeId: rule.officeId, steps };
}

// ---------------------------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------------------------

/**
 * Eligible = active member AND holds the step's role AND that role grants the step kind's
 * permission AND has access to the PR's requesting office AND is not the PR creator AND has not
 * signed a different step of the PR in any cycle AND has not signed in the current cycle
 * (re-signing the same step after a Return is allowed, FR-032). An assigned step admits only
 * its assignee.
 */
export function candidateIsEligible(
  candidate: Candidate,
  step: EligibilityStep,
  pr: EligibilityPr,
  facts: EligibilityFacts
): boolean {
  if (candidate.status !== 'active') return false;
  if (step.assignedUserId !== null && candidate.userId !== step.assignedUserId) return false;
  if (!candidate.roleIds.includes(step.requiredRoleId)) return false;

  const granted = facts.rolePermissions.get(step.requiredRoleId) ?? [];
  if (!granted.includes(STEP_KIND_PERMISSION[step.kind])) return false;

  if (!candidate.orgWideAccess && !candidate.officeIds.includes(pr.requestingOfficeId)) {
    return false;
  }
  if (pr.requesterId !== null && candidate.userId === pr.requesterId) return false;

  return !facts.signatures.some(
    (s) =>
      s.userId === candidate.userId &&
      s.action === 'approve' &&
      (s.stepOrder !== step.stepOrder || s.cycle === step.cycle)
  );
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

export interface RoleName {
  nameAr: string;
  nameEn: string;
}

/** Reads the routing rules need; implemented over SQL in approval-rule.repository.ts. */
export interface ApprovalRoutingStore {
  /** every PR rule of the tenant, with steps */
  listRules(): Promise<RuleLike[]>;
  /** members holding the role, with all their roles and offices */
  roleHolders(roleId: string): Promise<Candidate[]>;
  rolePermissions(roleIds: readonly string[]): Promise<Map<string, Permission[]>>;
  roleNames(roleIds: readonly string[]): Promise<Map<string, RoleName>>;
  prSignatures(prId: string): Promise<Signature[]>;
}

export interface PrStepRow {
  prId: string;
  cycle: number;
  stepOrder: number;
  kind: StepKind;
  requiredRoleId: string;
  ruleStepId: string;
  status: 'pending' | 'waiting';
}

/** Inserts pr_approval_step rows inside the submit transaction. */
export type PrStepWriter = (tx: TxSql, rows: readonly PrStepRow[]) => Promise<void>;

export class ApprovalRoutingService {
  constructor(
    private readonly store: ApprovalRoutingStore,
    private readonly writeSteps?: PrStepWriter
  ) {}

  validateRule(steps: readonly RuleStepDraft[]): void {
    validateRule(steps);
  }

  /** Office rule else organization rule; 422 APPROVAL_RULE_INVALID `no_rule` when neither. */
  async resolveRoute(officeId: string, doaAmount: string): Promise<Route> {
    const rule = pickRule(await this.store.listRules(), officeId);
    if (!rule) {
      throw new AppError('APPROVAL_RULE_INVALID', 'No active approval rule applies', {
        issues: [{ reason: 'no_rule' }],
      });
    }
    return routeFor(rule, doaAmount);
  }

  async eligibleUsers(step: EligibilityStep, pr: EligibilityPr): Promise<Candidate[]> {
    const [holders, rolePermissions, signatures] = await Promise.all([
      this.store.roleHolders(step.requiredRoleId),
      this.store.rolePermissions([step.requiredRoleId]),
      pr.id ? this.store.prSignatures(pr.id) : Promise.resolve([]),
    ]);
    const facts = { rolePermissions, signatures };
    return holders.filter((c) => candidateIsEligible(c, step, pr, facts));
  }

  async isEligible(userId: string, step: EligibilityStep, pr: EligibilityPr): Promise<boolean> {
    return (await this.eligibleUsers(step, pr)).some((c) => c.userId === userId);
  }

  /** Eligible-user count per route step, for `cycle`. */
  async eligibleCounts(route: Route, pr: EligibilityPr, cycle: number): Promise<number[]> {
    return Promise.all(
      route.steps.map(
        async (s) =>
          (
            await this.eligibleUsers(
              {
                cycle,
                stepOrder: s.stepOrder,
                kind: s.kind,
                requiredRoleId: s.roleId,
                assignedUserId: null,
              },
              pr
            )
          ).length
      )
    );
  }

  /** 422 NO_ELIGIBLE_APPROVER naming the first step, role and rule with nobody to sign (FR-020). */
  async assertRouteEligible(route: Route, pr: EligibilityPr, cycle: number): Promise<void> {
    const counts = await this.eligibleCounts(route, pr, cycle);
    const index = counts.findIndex((n) => n === 0);
    if (index < 0) return;
    const step = route.steps[index]!;
    const names = await this.store.roleNames([step.roleId]);
    throw new AppError('NO_ELIGIBLE_APPROVER', `No eligible user for step ${step.stepOrder}`, {
      stepOrder: step.stepOrder,
      kind: step.kind,
      roleId: step.roleId,
      roleName: names.get(step.roleId)?.nameEn ?? '',
      ruleId: route.ruleId,
    });
  }

  /** Freezes the route for this cycle: step 1 `pending`, the rest `waiting` (FR-005). */
  async materialiseSteps(
    tx: TxSql,
    pr: { id: string },
    cycle: number,
    route: Route
  ): Promise<PrStepRow[]> {
    if (!this.writeSteps) throw new Error('ApprovalRoutingService: no step writer configured');
    const rows: PrStepRow[] = route.steps.map((s, i) => ({
      prId: pr.id,
      cycle,
      stepOrder: s.stepOrder,
      kind: s.kind,
      requiredRoleId: s.roleId,
      ruleStepId: s.ruleStepId,
      status: i === 0 ? 'pending' : 'waiting',
    }));
    await this.writeSteps(tx, rows);
    return rows;
  }
}
