// Bodies and responses of the shared document actions (contracts/rest-api.md "Shared document
// actions"): every approvable type exposes submit, approve, reject, return, cancel, reassign
// and history through document-workflow.service.ts. Bodies are `.strict()`: unknown keys are
// rejected, so computed fields can never be sent.
import { z } from 'zod';
import type { DocStepKind, DocTypeCode } from '../doc-types';
import type { PrHistoryChange } from './history';
import { expectedVersion, uuid } from './common';

const reason = z.string().trim().min(1).max(2000);
const comment = z.string().trim().max(2000).nullish();

/** POST /X/:id/submit */
export const docSubmit = z.object({ expectedVersion }).strict();

/**
 * POST /X/:id/approve. `frozenGrantOverrideReason`: PAY and DPR only, a Finance Manager signs on
 * a suspended or closed grant with a reason (FR-096).
 */
export const docApprove = z
  .object({ expectedVersion, stepId: uuid, comment, frozenGrantOverrideReason: reason.optional() })
  .strict();

/** POST /X/:id/reject and /X/:id/return */
export const docReasonAction = z.object({ expectedVersion, stepId: uuid, reason }).strict();

/** POST /X/:id/cancel */
export const docCancel = z.object({ expectedVersion, reason }).strict();

/** POST /X/:id/steps/:stepId/reassign */
export const docReassign = z.object({ expectedVersion, userId: uuid, reason }).strict();

export const docStepParams = z.object({ id: uuid, stepId: uuid });

export type DocSubmit = z.infer<typeof docSubmit>;
export type DocApprove = z.infer<typeof docApprove>;
export type DocReasonAction = z.infer<typeof docReasonAction>;
export type DocCancel = z.infer<typeof docCancel>;
export type DocReassign = z.infer<typeof docReassign>;

export const DOC_ACTIONS = ['submit', 'approve', 'reject', 'return', 'cancel', 'reassign'] as const;
export type DocAction = (typeof DOC_ACTIONS)[number];

/** Response of every workflow command. */
export interface DocActionResult {
  id: string;
  docType: DocTypeCode;
  status: string;
  version: number;
  number: string | null;
  currentStepOrder: number | null;
}

export type DocStepStatus =
  'waiting' | 'pending' | 'approved' | 'rejected' | 'returned' | 'cancelled';

/** One route step as a detail response shows it, with the caller's possible actions. */
export interface DocStepView {
  id: string;
  cycle: number;
  stepOrder: number;
  kind: DocStepKind;
  requiredRoleId: string;
  roleNameAr: string;
  roleNameEn: string;
  assignedUserId: string | null;
  status: DocStepStatus;
  actedAt: string | null;
  canApprove: boolean;
  canReject: boolean;
  canReturn: boolean;
}

// ---------------------------------------------------------------------------------------------
// History (GET /X/:id/history) — the 001 timeline shape for any document
// ---------------------------------------------------------------------------------------------

export interface DocHistoryEntry {
  at: string;
  actor: { userId: string | null; nameAr: string; nameEn: string; position: string | null };
  /** a doc_signature action, or create / update for record changes */
  action: string;
  fromState: string | null;
  toState: string | null;
  comment: string | null;
  cycle: number | null;
  stepKind: string | null;
  /** the table of a record change (`purchase_order`, `po_line`, …); null for signatures */
  tableName: string | null;
  changes: PrHistoryChange[];
}
