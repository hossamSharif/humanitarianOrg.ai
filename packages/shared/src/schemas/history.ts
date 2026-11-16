// PR history timeline (contracts/rest-api.md `GET /prs/:id/history`, FR-044). Built from the
// append-only audit_history of the PR and its children plus the approval_action signatures;
// consecutive draft edits by one user within 10 minutes arrive as a single `update` entry.
import type { PrStatus } from '../pr-state';

export const PR_HISTORY_ACTIONS = [
  'create',
  'update',
  'submit',
  'resubmit',
  'approve',
  'reject',
  'return',
  'cancel',
  'reassign',
  'change_budget_line',
] as const;
export type PrHistoryAction = (typeof PR_HISTORY_ACTIONS)[number];

/** Minutes within which consecutive draft edits by the same user form one entry. */
export const HISTORY_EDIT_MERGE_MINUTES = 10;

export interface PrHistoryChange {
  /**
   * camelCase header field (`purpose`), `line.<field>` for a line field (`line.quantity`),
   * `line` for an added / removed line, `attachment` for an added / removed file
   */
  field: string;
  /** line number for `line*` changes */
  lineNo?: number;
  from: string | null;
  to: string | null;
}

export interface PrHistoryEntry {
  at: string;
  actor: { userId: string | null; nameAr: string; nameEn: string; position: string | null };
  action: PrHistoryAction;
  fromState: PrStatus | null;
  toState: PrStatus | null;
  comment: string | null;
  /** submission cycle of a workflow action; null for draft edits */
  cycle: number | null;
  /** the step kind of approve / reject / return / reassign */
  stepKind: string | null;
  changes: PrHistoryChange[];
}
