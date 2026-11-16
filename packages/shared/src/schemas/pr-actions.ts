// Bodies and responses of the PR workflow commands after submission (contracts/rest-api.md
// "Purchase requisitions"): sign, reject, return, change a line's budget line during the finance
// check, and reassign a step (US5); cancel (US6). Reasons are required and stored on the
// approval_action row.
import { z } from 'zod';
import type { PrStatus } from '../pr-state';
import { expectedVersion, uuid } from './common';

const reason = z.string().trim().min(1).max(2000);
const comment = z.string().trim().max(2000).nullish();

/** POST /prs/:id/approve */
export const prApprove = z.object({ expectedVersion, stepId: uuid, comment });

/** POST /prs/:id/reject and /prs/:id/return */
export const prReasonAction = z.object({ expectedVersion, stepId: uuid, reason });

/** POST /prs/:id/lines/:lineId/budget-line */
export const prChangeBudgetLine = z.object({ expectedVersion, budgetLineId: uuid, comment });

/** POST /prs/:id/steps/:stepId/reassign */
export const prReassign = z.object({ expectedVersion, userId: uuid, reason });

/** POST /prs/:id/cancel */
export const prCancel = z.object({ expectedVersion, reason });

export const prLineParams = z.object({ id: uuid, lineId: uuid });
export const prStepParams = z.object({ id: uuid, stepId: uuid });

export type PrApprove = z.infer<typeof prApprove>;
export type PrReasonAction = z.infer<typeof prReasonAction>;
export type PrChangeBudgetLine = z.infer<typeof prChangeBudgetLine>;
export type PrReassign = z.infer<typeof prReassign>;
export type PrCancel = z.infer<typeof prCancel>;

/** Response of every workflow command. */
export interface PrActionResult {
  id: string;
  status: PrStatus;
  version: number;
  currentStepOrder: number | null;
}

/** GET /prs/:id/steps/:stepId/eligible-users — reassignment targets. */
export interface PrEligibleUser {
  userId: string;
  nameAr: string;
  nameEn: string;
  position: string | null;
}
