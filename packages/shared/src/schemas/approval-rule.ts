// Approval rule (DoA) bodies (research R8, FR-019, FR-035). Amount bands are in the tenant's DoA
// reference currency: a band matches `min < amount ≤ max`; null min = 0, null max = no limit.
// Structural rules (finance check first, contiguous bands) are checked by the API's
// approval-routing service, which answers 422 APPROVAL_RULE_INVALID with the issues below.
import { z } from 'zod';
import type { StepKind } from '../permissions';
import { moneyString, uuid } from './common';

export const stepKind = z.enum(['finance_check', 'approval', 'final_approval']);

const optionalAmount = z
  .union([moneyString, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v));

export const approvalRuleStep = z.object({
  stepOrder: z.number().int().min(1).max(20),
  kind: stepKind,
  roleId: uuid,
  minAmount: optionalAmount,
  maxAmount: optionalAmount,
});

export const approvalRuleBody = z.object({
  officeId: uuid.nullable(),
  name: z.string().trim().min(1).max(200),
  isActive: z.boolean().default(true),
  steps: z.array(approvalRuleStep).min(1).max(50),
});

export const approvalRuleListQuery = z.object({
  docType: z.literal('PR').default('PR'),
});

export const approvalRuleResolve = z.object({
  officeId: uuid,
  /** DoA reference-currency amount */
  amount: moneyString,
});

export type ApprovalRuleStepInput = z.infer<typeof approvalRuleStep>;
export type ApprovalRuleBody = z.infer<typeof approvalRuleBody>;
export type ApprovalRuleBodyInput = z.input<typeof approvalRuleBody>;
export type ApprovalRuleResolve = z.infer<typeof approvalRuleResolve>;

export type ApprovalRuleIssueReason =
  | 'no_steps'
  | 'step_order_gap'
  | 'first_step_not_finance_check'
  | 'multiple_finance_check'
  | 'finance_check_banded'
  | 'missing_final_approval'
  | 'final_not_highest'
  | 'non_final_banded'
  | 'non_final_multiple_rows'
  | 'band_not_from_zero'
  | 'band_gap'
  | 'band_overlap'
  | 'band_not_open_ended'
  | 'band_empty'
  | 'role_not_found';

export interface ApprovalRuleIssue {
  reason: ApprovalRuleIssueReason;
  stepOrder?: number;
}

export interface ApprovalRuleStep {
  id: string;
  stepOrder: number;
  kind: StepKind;
  roleId: string;
  minAmount: string | null;
  maxAmount: string | null;
}

export interface ApprovalRule {
  id: string;
  docType: 'PR';
  officeId: string | null;
  name: string;
  isActive: boolean;
  steps: ApprovalRuleStep[];
}

/** POST /approval-rules/resolve response: the route a PR would take, with eligible counts. */
export interface ResolvedRoute {
  ruleId: string;
  ruleName: string;
  officeId: string | null;
  amount: string;
  currency: string;
  steps: {
    stepOrder: number;
    kind: StepKind;
    roleId: string;
    roleNameAr: string;
    roleNameEn: string;
    ruleStepId: string;
    minAmount: string | null;
    maxAmount: string | null;
    eligibleCount: number;
  }[];
}
