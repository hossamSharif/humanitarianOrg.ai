// Purchase requisition state machine (data-model §6). Guards that need data (eligibility,
// budget, segregation of duties) live in the PR service; this table only says which actions a
// status admits and where they can lead.

export const PR_STATUSES = [
  'draft',
  'pending_finance_check',
  'pending_approval',
  'approved',
  'returned',
  'rejected',
  'cancelled',
] as const;

export type PrStatus = (typeof PR_STATUSES)[number];

export type PrAction =
  | 'update'
  | 'delete'
  | 'submit'
  | 'approve'
  | 'reject'
  | 'return'
  | 'cancel'
  | 'change_budget_line'
  | 'reassign';

export interface PrTransition {
  from: PrStatus;
  action: PrAction;
  /** null: the row is removed (delete of a never-submitted draft) */
  to: PrStatus | null;
}

export const TRANSITIONS: readonly PrTransition[] = [
  // creator edits and submits
  { from: 'draft', action: 'update', to: 'draft' },
  { from: 'draft', action: 'delete', to: null },
  { from: 'draft', action: 'submit', to: 'pending_finance_check' },
  { from: 'returned', action: 'update', to: 'returned' },
  { from: 'returned', action: 'submit', to: 'pending_finance_check' },
  { from: 'returned', action: 'cancel', to: 'cancelled' },

  // finance check (step 1)
  { from: 'pending_finance_check', action: 'approve', to: 'pending_approval' },
  { from: 'pending_finance_check', action: 'change_budget_line', to: 'pending_finance_check' },
  { from: 'pending_finance_check', action: 'reject', to: 'rejected' },
  { from: 'pending_finance_check', action: 'return', to: 'returned' },
  { from: 'pending_finance_check', action: 'cancel', to: 'cancelled' },
  { from: 'pending_finance_check', action: 'reassign', to: 'pending_finance_check' },

  // approval steps: an intermediate approval stays pending; the final one approves
  { from: 'pending_approval', action: 'approve', to: 'pending_approval' },
  { from: 'pending_approval', action: 'approve', to: 'approved' },
  { from: 'pending_approval', action: 'reject', to: 'rejected' },
  { from: 'pending_approval', action: 'return', to: 'returned' },
  { from: 'pending_approval', action: 'cancel', to: 'cancelled' },
  { from: 'pending_approval', action: 'reassign', to: 'pending_approval' },

  // approved PRs change only by cancellation (pr:cancel_approved)
  { from: 'approved', action: 'cancel', to: 'cancelled' },
];

export function canTransition(from: PrStatus, action: PrAction): boolean {
  return TRANSITIONS.some((t) => t.from === from && t.action === action);
}

/** Possible target statuses of an action; empty when the action is not allowed. */
export function targetsOf(from: PrStatus, action: PrAction): (PrStatus | null)[] {
  return TRANSITIONS.filter((t) => t.from === from && t.action === action).map((t) => t.to);
}

/** Actions a status admits, without data-dependent guards. */
export function actionsFrom(from: PrStatus): PrAction[] {
  return [...new Set(TRANSITIONS.filter((t) => t.from === from).map((t) => t.action))];
}

export function isPending(status: PrStatus): boolean {
  return status === 'pending_finance_check' || status === 'pending_approval';
}

export function isFinal(status: PrStatus): boolean {
  return status === 'rejected' || status === 'cancelled';
}

export function isEditableByRequester(status: PrStatus): boolean {
  return status === 'draft' || status === 'returned';
}

export type PrintWatermark = 'DRAFT' | 'PENDING' | 'REJECTED' | 'CANCELLED';

/** contracts/print-layout.md: approved prints clean; everything else carries a watermark. */
export function watermarkFor(status: PrStatus): PrintWatermark | null {
  switch (status) {
    case 'draft':
    case 'returned':
      return 'DRAFT';
    case 'pending_finance_check':
    case 'pending_approval':
      return 'PENDING';
    case 'rejected':
      return 'REJECTED';
    case 'cancelled':
      return 'CANCELLED';
    case 'approved':
      return null;
  }
}
