// Separation of duties for every document type (contracts/rls-and-permissions.md §3, Business
// Rule 8, SC-010). This is the only place these rules live: the document workflow, step
// eligibility (approval-routing.service) and the receipt / payment / scoring commands all ask
// `canSign`. The database backs the strongest rules up (unique signature indexes, the voucher
// three-signer trigger), so a missed service path still cannot commit a violation.
import {
  DOC_TYPE_DOA,
  type DocStepKind,
  type DocTypeCode,
  type SegregationRule,
} from '@ngo/shared';
import { AppError } from '../middleware/error';

/** What the caller is about to do. */
export type SignIntent =
  | { kind: 'step'; stepKind: DocStepKind; stepOrder: number; cycle: number }
  | { kind: 'received' | 'inspected' | 'certified' | 'confirmed' }
  | { kind: 'override_match' }
  | { kind: 'score' };

/** A doc_signature row of the document (any cycle). */
export interface PriorSignature {
  userId: string;
  action: string;
  cycle: number;
  stepOrder: number | null;
}

/** The facts the rules need about the document; adapters fill what their type uses. */
export interface SegregationDoc {
  docType: DocTypeCode;
  /** created_by / requester / entered_by / preparer; null when unknown (route preview) */
  creatorId: string | null;
  /** AWARD: requesters of every PR feeding the sourcing event */
  prRequesterIds?: readonly string[];
  /** PAY: signers of received / inspected / certified / confirmed on the matched GRNs and SCCs */
  receiptSignerIds?: readonly string[];
  /** QA scoring: the caller's committee declaration; null = not a member or not declared */
  declaration?: { hasConflict: boolean } | null;
}

export type SignCheck = { ok: true } | { ok: false; rule: SegregationRule };

const OK: SignCheck = { ok: true };
const deny = (rule: SegregationRule): SignCheck => ({ ok: false, rule });

const PAYMENT_TYPES: readonly DocTypeCode[] = ['PAY', 'DPR'];
const VOUCHER_DOA = new Set(['PV', 'RV', 'JV']);

/** Signed another step of the document: in any cycle, unless it is the same step order (001 FR-032). */
function signedOtherStep(
  userId: string,
  intent: { stepOrder: number; cycle: number },
  prior: readonly PriorSignature[]
): boolean {
  return prior.some(
    (s) =>
      s.userId === userId &&
      s.action === 'approve' &&
      (s.stepOrder !== intent.stepOrder || s.cycle === intent.cycle)
  );
}

/** The two signatures of a receipt or certificate come from two people. */
const COUNTERPART: Record<string, { action: string; rule: SegregationRule }> = {
  received: { action: 'inspected', rule: 'receiver_is_inspector' },
  inspected: { action: 'received', rule: 'receiver_is_inspector' },
  certified: { action: 'confirmed', rule: 'certifier_is_confirmer' },
  confirmed: { action: 'certified', rule: 'certifier_is_confirmer' },
};

function stepCheck(
  doc: SegregationDoc,
  userId: string,
  intent: Extract<SignIntent, { kind: 'step' }>,
  prior: readonly PriorSignature[]
): SignCheck {
  const doa = DOC_TYPE_DOA[doc.docType];

  // vouchers: entered by ≠ checked by ≠ approved by (pairwise)
  if (doa !== null && VOUCHER_DOA.has(doa)) {
    if (doc.creatorId === userId || signedOtherStep(userId, intent, prior)) {
      return deny('voucher_three_people');
    }
    return OK;
  }

  if (PAYMENT_TYPES.includes(doc.docType)) {
    if (doc.creatorId === userId) return deny('preparer_approves_payment');
    if (doc.docType === 'PAY' && doc.receiptSignerIds?.includes(userId)) {
      return deny('receiver_approves_payment');
    }
  } else if (doc.creatorId === userId) {
    return deny('creator_approves');
  }

  if (doc.docType === 'QA' && doc.prRequesterIds?.includes(userId)) {
    return deny('pr_creator_approves_award');
  }
  if (signedOtherStep(userId, intent, prior)) return deny('same_user_two_steps');
  return OK;
}

/**
 * May `userId` do `intent` on the document, given its earlier signatures? Returns the first
 * rule that forbids it.
 */
export function canSign(
  doc: SegregationDoc,
  userId: string,
  intent: SignIntent,
  prior: readonly PriorSignature[]
): SignCheck {
  switch (intent.kind) {
    case 'step':
      return stepCheck(doc, userId, intent, prior);
    case 'received':
    case 'inspected':
    case 'certified':
    case 'confirmed': {
      const other = COUNTERPART[intent.kind]!;
      return prior.some((s) => s.userId === userId && s.action === other.action)
        ? deny(other.rule)
        : OK;
    }
    case 'override_match':
      return doc.creatorId === userId ? deny('override_by_preparer') : OK;
    case 'score':
      return doc.declaration && !doc.declaration.hasConflict
        ? OK
        : deny('undeclared_member_scores');
  }
}

const RULE_MESSAGES: Record<SegregationRule, string> = {
  creator_approves: 'The creator of a document cannot sign its approval steps',
  same_user_two_steps: 'A user who signed one step cannot sign another step of the same document',
  pr_creator_approves_award:
    'The requester of a purchase requisition in this sourcing cannot approve its award',
  receiver_is_inspector: 'The receiver and the inspector must be different people',
  certifier_is_confirmer: 'The certifier and the confirmer must be different people',
  preparer_approves_payment: 'The preparer of a payment request cannot sign its steps',
  receiver_approves_payment:
    'A receiver, inspector or certifier of the matched receipts cannot sign this payment',
  voucher_three_people: 'A voucher is entered, checked and approved by three different people',
  override_by_preparer: 'The preparer of a payment request cannot override its match',
  undeclared_member_scores:
    'Only a committee member who declared no conflict of interest may see prices or score',
};

/** 403 SEGREGATION_OF_DUTIES with `details.rule`, or nothing. */
export function assertCanSign(
  doc: SegregationDoc,
  userId: string,
  intent: SignIntent,
  prior: readonly PriorSignature[],
  messages: Partial<Record<SegregationRule, string>> = {}
): void {
  const check = canSign(doc, userId, intent, prior);
  if (!check.ok) {
    throw new AppError('SEGREGATION_OF_DUTIES', messages[check.rule] ?? RULE_MESSAGES[check.rule], {
      rule: check.rule,
    });
  }
}
