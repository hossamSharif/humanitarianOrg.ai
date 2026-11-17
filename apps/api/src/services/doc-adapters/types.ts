// The contract between document-workflow.service.ts and one document type (research D1). The
// engine owns the shared rules — state checks, optimistic versions, numbering at first
// submission, route resolution and eligibility, segregation, signatures, step bookkeeping and
// notifications; an adapter supplies what differs per type: how the document is loaded and
// written, its DoA amount and office, its segregation facts, and the budget effects of
// submission, final approval and release. Adapters are built per transaction, so their hooks
// close over that transaction's repositories.
import type { DoaType, DocStepKind, DocTypeCode, Permission, SegregationRule } from '@ngo/shared';
import type {
  ApprovalRoutingService,
  EligibilityPr,
  EligibilityStep,
  Route,
} from '../approval-routing.service';
import type { PriorSignature, SegregationDoc } from '../segregation.service';

/** The header fields every approvable document has (data-model ⟨doc⟩). */
export interface WorkflowDoc {
  id: string;
  status: string;
  version: number;
  number: string | null;
  submissionCycle: number;
  currentStepOrder: number | null;
}

export interface WorkflowActor {
  userId: string;
  permissions: ReadonlySet<Permission>;
}

/** Name and position at the moment of acting (signature snapshot, FR-031). */
export interface ActorSnapshot {
  nameAr: string;
  nameEn: string;
  position: string | null;
}

/** What `prepareSubmit` decided; `state` is the adapter's own, handed back to later hooks. */
export interface SubmitPlan<S> {
  officeId: string;
  /** in the DoA reference currency, locked at submission (001 R7); routes the document */
  doaAmount: string;
  /** the number's year is the year of the submission instant in this time zone */
  timeZone: string;
  submittedAt: Date;
  state: S;
}

export interface MaterialisedStep {
  stepOrder: number;
  kind: DocStepKind;
  status: 'pending' | 'waiting';
}

export interface WorkflowStep {
  id: string;
  cycle: number;
  stepOrder: number;
  kind: DocStepKind;
  requiredRoleId: string;
  assignedUserId: string | null;
  status: string;
  roleNameAr?: string;
  roleNameEn?: string;
  actedAt?: string | null;
}

export interface WorkflowStepStore {
  list(docId: string, cycle: number): Promise<WorkflowStep[]>;
  update(
    id: string,
    changes: { status?: WorkflowStepStatus; actedAt?: string; assignedUserId?: string }
  ): Promise<void>;
  cancelWaiting(docId: string, cycle: number): Promise<void>;
  /** freezes the route for the cycle: step 1 `pending`, the rest `waiting` (FR-005) */
  materialise(docId: string, cycle: number, route: Route): Promise<MaterialisedStep[]>;
}

export type WorkflowStepStatus = 'pending' | 'approved' | 'rejected' | 'returned' | 'cancelled';

export type WorkflowSignatureAction =
  'submit' | 'approve' | 'reject' | 'return' | 'cancel' | 'reassign';

export interface WorkflowSignature {
  docId: string;
  stepId: string | null;
  cycle: number;
  stepOrder: number | null;
  action: WorkflowSignatureAction;
  userName: string;
  userPosition: string | null;
  comment: string | null;
  payload: Record<string, unknown> | null;
}

export interface WorkflowSignatureStore {
  insert(row: WorkflowSignature): Promise<void>;
  list(docId: string): Promise<PriorSignature[]>;
}

/** The document as notifications and eligibility see it. */
export interface DocRef extends EligibilityPr {
  id: string;
  number: string | null;
}

export type Outcome = 'approved' | 'rejected' | 'returned' | 'cancelled';

export interface WorkflowNotifier {
  stepEligible(doc: DocRef, step: EligibilityStep, actorName: string): Promise<void>;
  creator(doc: DocRef, outcome: Outcome, actorName: string): Promise<void>;
  reassigned(
    doc: DocRef,
    step: Pick<EligibilityStep, 'kind'>,
    userId: string,
    actorName: string
  ): Promise<void>;
}

/** How a command changed the header; the adapter maps it onto its columns. */
export type StatusChange =
  | { kind: 'advanced'; status: string; currentStepOrder: number }
  | { kind: 'approved'; at: string }
  | { kind: 'rejected'; reason: string; by: string; at: string }
  | { kind: 'returned'; reason: string; by: string; at: string }
  | { kind: 'cancelled'; reason: string; by: string; at: string }
  /** version bump only (reassign) */
  | { kind: 'touched' };

export interface SubmittedInfo {
  number: string;
  cycle: number;
  firstStepOrder: number;
  firstStepStatus: string;
  actor: ActorSnapshot;
}

export interface DocAdapter<D extends WorkflowDoc, S = unknown> {
  readonly docType: DocTypeCode;
  readonly doaType: DoaType;
  /** holding any one of these lets a user reassign a step */
  readonly reassignPermissions: readonly Permission[];
  /** messages for segregation refusals, where the type words them differently */
  readonly segregationMessages?: Partial<Record<SegregationRule, string>>;

  load(id: string, options: { lock: boolean }): Promise<D | null>;
  creatorId(doc: D): string;
  /** the office that routes and scopes the document (set once it is submitted) */
  officeId(doc: D): string;
  /** extra facts its segregation policy needs (AWARD: PR requesters, PAY: receipt signers) */
  segregationFacts?(doc: D): Promise<Omit<SegregationDoc, 'docType' | 'creatorId'>>;

  /** 403/409 unless the actor may submit the document now (state and ownership) */
  assertMaySubmit(doc: D, actor: WorkflowActor): void;
  isPending(status: string): boolean;
  /** the status while `step` is the current step */
  pendingStatus(step: { kind: DocStepKind; stepOrder: number }): string;
  cancellable(status: string): boolean;
  mayCancel(doc: D, actor: WorkflowActor): boolean;
  /** FORBIDDEN message when mayCancel is false */
  cancelForbiddenMessage?(doc: D): string;

  /** every submission rule of the type; returns the route inputs and adapter state */
  prepareSubmit(doc: D): Promise<SubmitPlan<S>>;
  /** after the route is known and eligible, before the number: reservations and the like */
  onSubmit(doc: D, plan: SubmitPlan<S>, cycle: number): Promise<void>;
  /** writes status, number, cycle, locked amounts and print snapshot; returns the new version */
  markSubmitted(doc: D, plan: SubmitPlan<S>, info: SubmittedInfo): Promise<number>;
  /** payload of the `submit` signature */
  submitPayload?(
    doc: D,
    plan: SubmitPlan<S>,
    number: string,
    actor: ActorSnapshot
  ): Record<string, unknown>;

  /** checks before a step is signed; return/reject/cancel stay allowed (FR-022, FR-096) */
  beforeSign?(doc: D): Promise<void>;
  /** the grant is suspended or closed (FR-096) */
  grantFrozen?(doc: D): Promise<boolean>;
  /** PAY and DPR may be signed on a frozen grant with a Finance Manager override and reason */
  readonly frozenGrantOverride?: boolean;

  /** final approval: budget effects (commit), before the status write */
  onApproved(doc: D): Promise<void>;
  /** return, reject, cancel: release exactly what the document holds (BR-21) */
  onReleased(doc: D, reason: Exclude<Outcome, 'approved'>): Promise<void>;
  setStatus(doc: D, change: StatusChange): Promise<number>;

  /** route eligibility and notification view of the document */
  ref(doc: D, number?: string | null): DocRef;
}

/** Everything one command needs, bound to one transaction. */
export interface WorkflowBinding<D extends WorkflowDoc, S = unknown> {
  adapter: DocAdapter<D, S>;
  steps: WorkflowStepStore;
  signatures: WorkflowSignatureStore;
  routing: ApprovalRoutingService;
  notifier: WorkflowNotifier;
  actorSnapshot(userId: string): Promise<ActorSnapshot>;
  setAuditComment(comment: string | null): Promise<void>;
  /** inside the same transaction (document_sequence row lock) */
  assignNumber(
    docType: DocTypeCode,
    officeId: string,
    submittedAt: Date,
    timeZone: string
  ): Promise<string>;
}
