// Purchase requisition drafts (US4): create, autosave, delete, the read model with the caller's
// available actions, and attachments (FR-024, FR-027, FR-043, research R10–R11). Submission and
// the approval actions live in pr-workflow.service.ts. Everything runs in one tenant transaction
// per call, so RLS applies and an autosave locks the PR it diffs against.
import { randomUUID } from 'node:crypto';
import {
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENTS_PER_PR,
  MAX_ATTACHMENT_BYTES,
  PERMISSIONS,
  isEditableByRequester,
  isPending,
  parseAmount,
  sumByCurrency,
  type AttachmentUpload,
  type AttachmentUploadTarget,
  type Permission,
  type PrAction,
  type PrAttachmentView,
  type PrCreate,
  type PrCreated,
  type PrDetail,
  type PrDraftHeader,
  type PrDraftLine,
  type PrDraftSaved,
  type PrDraftUpdate,
  type PrEligibleUser,
  type PrLineView,
  type PrStepView,
} from '@ngo/shared';
import { withTenantTx, type TenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import {
  ApprovalActionRepository,
  type ApprovalActionStore,
} from '../repositories/approval-action.repository';
import { ApprovalRuleRepository, prStepWriter } from '../repositories/approval-rule.repository';
import {
  BudgetCommitmentRepository,
  type BudgetCommitmentStore,
} from '../repositories/budget-commitment.repository';
import {
  PrApprovalStepRepository,
  type PrApprovalStepStore,
} from '../repositories/pr-approval-step.repository';
import {
  PrAttachmentRepository,
  SupabaseAttachmentStorage,
  type AttachmentRecord,
  type AttachmentStorage,
  type PrAttachmentStore,
} from '../repositories/pr-attachment.repository';
import {
  HEADER_FIELDS,
  LINE_FIELDS,
  PrRepository,
  type PrHeaderValues,
  type PrLineRecord,
  type PrLineValues,
  type PrRecord,
  type PrStore,
} from '../repositories/pr.repository';
import type { RequestContext } from '../types/context';
import { ApprovalRoutingService } from './approval-routing.service';

/** Who is calling: the creator checks, office scope and permission-dependent actions. */
export interface PrActor {
  userId: string;
  tenantId: string;
  permissions: ReadonlySet<Permission>;
  officeIds: readonly string[];
  orgWideAccess: boolean;
}

/** The stores of one transaction. */
export interface PrRepos {
  prs: PrStore;
  attachments: PrAttachmentStore;
  steps: PrApprovalStepStore;
  actions: ApprovalActionStore;
  commitments: BudgetCommitmentStore;
  routing: ApprovalRoutingService;
}

export interface PrServiceDeps {
  actor: PrActor;
  run<T>(fn: (repos: PrRepos, tx: TenantTx) => Promise<T>): Promise<T>;
  storage: AttachmentStorage;
  newId?: () => string;
}

export function actorOf(ctx: RequestContext): PrActor {
  return {
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    permissions: ctx.permissions,
    officeIds: ctx.officeIds,
    orgWideAccess: ctx.orgWideAccess,
  };
}

/** Repositories bound to one transaction connection. */
export function prRepos(tx: TenantTx, tenantId: string): PrRepos {
  return {
    prs: new PrRepository(tx.sql, tenantId),
    attachments: new PrAttachmentRepository(tx.sql, tenantId),
    steps: new PrApprovalStepRepository(tx.sql),
    actions: new ApprovalActionRepository(tx.sql, tenantId),
    commitments: new BudgetCommitmentRepository(tx.sql),
    routing: new ApprovalRoutingService(
      new ApprovalRuleRepository(tx.sql, tenantId),
      prStepWriter(tenantId)
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// Guards shared with the workflow service
// ---------------------------------------------------------------------------------------------

export async function getPr(prs: PrStore, id: string, options: { lock?: boolean } = {}) {
  const pr = options.lock ? await prs.lock(id) : await prs.find(id);
  if (!pr) throw new AppError('NOT_FOUND', 'purchase_requisition not found');
  return pr;
}

export function assertCreator(pr: PrRecord, actor: PrActor): void {
  if (pr.requesterId !== actor.userId) {
    throw new AppError('FORBIDDEN', 'Only the requester can change this purchase requisition');
  }
}

export function assertEditable(pr: PrRecord): void {
  if (!isEditableByRequester(pr.status)) {
    throw new AppError('INVALID_STATE', `A ${pr.status} purchase requisition cannot be edited`);
  }
}

export function assertVersion(pr: PrRecord, expectedVersion: number): void {
  if (pr.version !== expectedVersion) {
    throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
  }
}

function assertOfficeAccess(actor: PrActor, officeId: string | null): void {
  if (officeId && !actor.orgWideAccess && !actor.officeIds.includes(officeId)) {
    throw new AppError('FORBIDDEN', 'No access to the requesting office');
  }
}

/** Business Rule 2 / FR-023: budget lines and activities belong to the PR's grant. */
export async function assertGrantLinks(
  prs: PrStore,
  grantId: string | null,
  header: Pick<PrHeaderValues, 'activityId'>,
  lines: readonly Pick<PrLineValues, 'budgetLineId' | 'activityId'>[]
): Promise<void> {
  const budgetLineIds = lines.flatMap((l) => (l.budgetLineId ? [l.budgetLineId] : []));
  const activityIds = [
    ...(header.activityId ? [header.activityId] : []),
    ...lines.flatMap((l) => (l.activityId ? [l.activityId] : [])),
  ];
  const [lineGrants, activityGrants] = await Promise.all([
    prs.budgetLineGrants(budgetLineIds),
    prs.activityGrants(activityIds),
  ]);
  const mismatch =
    budgetLineIds.some((id) => grantId === null || lineGrants.get(id) !== grantId) ||
    activityIds.some((id) => grantId === null || activityGrants.get(id) !== grantId);
  if (mismatch) {
    throw new AppError(
      'PR_LINE_GRANT_MISMATCH',
      'Budget lines and activities must belong to the grant of the purchase requisition'
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Draft documents
// ---------------------------------------------------------------------------------------------

function headerValues(header: PrDraftHeader | undefined): PrHeaderValues {
  const out = {} as Record<keyof PrHeaderValues, unknown>;
  for (const field of HEADER_FIELDS) out[field] = header?.[field] ?? null;
  return out as unknown as PrHeaderValues;
}

/** Draft line with defaults: base currency, location = deliver-to office. */
function lineValues(
  line: PrDraftLine,
  defaults: { currency: string; locationOfficeId: string | null }
): PrLineValues {
  return {
    description: line.description ?? null,
    specifications: line.specifications ?? null,
    quantity: line.quantity ?? null,
    unitId: line.unitId ?? null,
    unitCost: line.unitCost ?? null,
    currency: line.currency ?? defaults.currency,
    budgetLineId: line.budgetLineId ?? null,
    locationOfficeId: line.locationOfficeId ?? defaults.locationOfficeId,
    activityId: line.activityId ?? null,
  };
}

/** Quantities and costs compare by value ('10' = '10.000'); everything else as stored. */
const NUMERIC_FIELDS = new Set(['quantity', 'unitCost']);

function sameValue(field: string, a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return NUMERIC_FIELDS.has(field) && parseAmount(a).equals(parseAmount(b));
}

function changedFields<T extends object, K extends keyof T & string>(
  current: T,
  next: T,
  fields: readonly K[]
): Partial<T> {
  const out: Partial<T> = {};
  for (const field of fields) {
    const a = current[field] as unknown as string | null;
    const b = next[field] as unknown as string | null;
    if (!sameValue(field, a, b)) out[field] = next[field];
  }
  return out;
}

export function assertAttachmentAllowed(input: AttachmentUpload, existingCount: number): void {
  const errors: { field: string; message: string }[] = [];
  if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    errors.push({ field: 'mimeType', message: 'unsupported_type' });
  }
  if (input.sizeBytes > MAX_ATTACHMENT_BYTES)
    errors.push({ field: 'sizeBytes', message: 'too_large' });
  if (input.sizeBytes < 1) errors.push({ field: 'sizeBytes', message: 'empty' });
  if (existingCount >= MAX_ATTACHMENTS_PER_PR) {
    errors.push({ field: 'attachments', message: 'too_many' });
  }
  if (errors.length)
    throw new AppError('VALIDATION_ERROR', 'The attachment is not allowed', errors);
}

function toAttachmentView(a: AttachmentRecord): PrAttachmentView {
  return {
    id: a.id,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    uploadedBy: a.uploadedBy,
    uploadedAt: a.uploadedAt,
  };
}

function toLineView(l: PrLineRecord): PrLineView {
  return { ...l };
}

export class PrService {
  private readonly newId: () => string;

  constructor(private readonly deps: PrServiceDeps) {
    this.newId = deps.newId ?? randomUUID;
  }

  static forContext(ctx: RequestContext): PrService {
    return new PrService({
      actor: actorOf(ctx),
      run: (fn) =>
        withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, (tx) =>
          fn(prRepos(tx, ctx.tenantId), tx)
        ),
      storage: new SupabaseAttachmentStorage(ctx),
    });
  }

  private get actor(): PrActor {
    return this.deps.actor;
  }

  /** POST /prs — header and lines may both be incomplete. */
  createDraft(input: PrCreate): Promise<PrCreated> {
    return this.deps.run(async ({ prs }) => {
      const header = headerValues(input.header);
      assertOfficeAccess(this.actor, header.requestingOfficeId);
      const settings = await prs.settings();
      const lines = (input.lines ?? []).map((l) =>
        lineValues(l, {
          currency: settings.baseCurrency,
          locationOfficeId: header.deliverToOfficeId,
        })
      );
      await assertGrantLinks(prs, header.grantId, header, lines);

      const pr = await prs.insert(header);
      await prs.insertLines(
        pr.id,
        lines.map((l, i) => ({ ...l, lineNo: i + 1 }))
      );
      return { id: pr.id, version: pr.version, status: 'draft' };
    });
  }

  /**
   * PATCH /prs/:id — autosave of the whole document. Lines are diffed against the stored ones
   * (update by id, insert new, delete removed) and renumbered 1..n; nothing is written and the
   * version stays when the body matches what is stored.
   */
  updateDraft(id: string, input: PrDraftUpdate): Promise<PrDraftSaved> {
    return this.deps.run(async ({ prs }) => {
      const pr = await getPr(prs, id, { lock: true });
      assertCreator(pr, this.actor);
      assertEditable(pr);
      assertVersion(pr, input.expectedVersion);

      const header = headerValues(input.header);
      const headerChanges = changedFields(pr, header as PrRecord, HEADER_FIELDS);
      if (headerChanges.requestingOfficeId !== undefined) {
        assertOfficeAccess(this.actor, header.requestingOfficeId);
      }
      const grantChanged = 'grantId' in headerChanges;

      const settings = await prs.settings();
      const incoming = input.lines.map((l) => ({
        id: l.id,
        values: lineValues(l, {
          currency: settings.baseCurrency,
          locationOfficeId: header.deliverToOfficeId,
        }),
      }));
      await assertGrantLinks(
        prs,
        header.grantId,
        header,
        incoming.map((l) => l.values)
      );

      // a grant change clears every line's budget line and activity first (they belonged to
      // the old grant), so compare against the cleared values
      const stored = new Map(
        (await prs.lines(id)).map((l) => [
          l.id,
          grantChanged ? { ...l, budgetLineId: null, activityId: null } : l,
        ])
      );
      const keep = new Set(incoming.flatMap((l) => (l.id && stored.has(l.id) ? [l.id] : [])));
      const toDelete = [...stored.keys()].filter((lineId) => !keep.has(lineId));
      const updates: { id: string; values: Partial<PrLineValues> & { lineNo?: number } }[] = [];
      const inserts: { index: number; values: PrLineValues & { lineNo: number } }[] = [];
      incoming.forEach((line, index) => {
        const lineNo = index + 1;
        const current = line.id ? stored.get(line.id) : undefined;
        if (!current) {
          inserts.push({ index, values: { ...line.values, lineNo } });
          return;
        }
        const changes: Partial<PrLineValues> & { lineNo?: number } = changedFields(
          current as PrLineValues,
          line.values,
          LINE_FIELDS
        );
        if (current.lineNo !== lineNo) changes.lineNo = lineNo;
        if (Object.keys(changes).length) updates.push({ id: current.id, values: changes });
      });

      const lineIds = incoming.map((l) => (l.id && keep.has(l.id) ? l.id : ''));
      const changed =
        Object.keys(headerChanges).length > 0 ||
        toDelete.length > 0 ||
        updates.length > 0 ||
        inserts.length > 0;
      if (!changed) {
        return { id, version: pr.version, status: pr.status, lineIds, changed: false };
      }

      if (grantChanged) await prs.clearGrantLinks(id);
      await prs.deleteLines(toDelete);
      // one version bump per save; a lines-only save touches the header
      const version = await prs.updateHeader(id, headerChanges);
      for (const u of updates) await prs.updateLine(u.id, u.values);
      const newIds = await prs.insertLines(
        id,
        inserts.map((i) => i.values)
      );
      inserts.forEach((ins, k) => (lineIds[ins.index] = newIds[k]!));

      return { id, version, status: pr.status, lineIds, changed: true };
    });
  }

  /** DELETE /prs/:id — only a draft that never received a number (Business Rule 8, FR-043). */
  deleteDraft(id: string): Promise<void> {
    return this.deps.run(async ({ prs }) => {
      const pr = await getPr(prs, id, { lock: true });
      assertCreator(pr, this.actor);
      if (pr.status !== 'draft' || pr.number !== null) {
        throw new AppError('INVALID_STATE', 'Only a draft that was never submitted can be deleted');
      }
      await prs.delete(id);
    });
  }

  /** GET /prs/:id */
  getDetail(id: string): Promise<PrDetail> {
    return this.deps.run(async (repos) => {
      const { prs } = repos;
      const pr = await getPr(prs, id);
      const [lines, attachments, actions, reservations, grant, steps] = await Promise.all([
        prs.lines(id),
        repos.attachments.list(id),
        repos.actions.list(id),
        repos.commitments.listForPr(id),
        pr.grantId ? prs.grant(pr.grantId) : Promise.resolve(null),
        pr.submissionCycle > 0 ? repos.steps.list(id, pr.submissionCycle) : Promise.resolve([]),
      ]);

      // the same rules the workflow commands enforce: segregation of duties (the requester, or
      // a signer of another step) and step eligibility; a frozen grant blocks signing only
      const grantFrozen = isPending(pr.status) && grant !== null && grant.status !== 'active';
      const signedOther = (stepOrder: number, cycle: number) =>
        actions.some(
          (a) =>
            a.userId === this.actor.userId &&
            a.action === 'approve' &&
            (a.stepOrder !== stepOrder || a.cycle === cycle)
        );
      const stepViews: PrStepView[] = [];
      for (const s of steps) {
        const actionable =
          isPending(pr.status) && s.status === 'pending' && s.stepOrder === pr.currentStepOrder;
        const eligible =
          actionable &&
          pr.requestingOfficeId !== null &&
          pr.requesterId !== this.actor.userId &&
          !signedOther(s.stepOrder, s.cycle) &&
          (await repos.routing.isEligible(
            this.actor.userId,
            {
              cycle: s.cycle,
              stepOrder: s.stepOrder,
              kind: s.kind,
              requiredRoleId: s.requiredRoleId,
              assignedUserId: s.assignedUserId,
            },
            { id: pr.id, requesterId: pr.requesterId, requestingOfficeId: pr.requestingOfficeId }
          ));
        stepViews.push({
          ...s,
          canApprove: eligible && !grantFrozen,
          canReject: eligible,
          canReturn: eligible,
          canChangeBudgetLine: eligible && s.kind === 'finance_check',
        });
      }

      return {
        ...pr,
        grantCurrency: grant?.currency ?? null,
        grantFrozen,
        lines: lines.map(toLineView),
        totals: sumByCurrency(
          lines.flatMap((l) =>
            l.lineTotal !== null ? [{ amount: l.lineTotal, currency: l.currency }] : []
          )
        ),
        attachments: attachments.filter((a) => a.uploadedAt !== null).map(toAttachmentView),
        steps: stepViews,
        actions,
        reservations,
        availableActions: this.availableActions(pr, stepViews),
      };
    });
  }

  /** The requester's actions, then the step actions of the current step and reassignment. */
  availableActions(pr: PrRecord, steps: readonly PrStepView[] = []): PrAction[] {
    const actions: PrAction[] = [];
    if (pr.requesterId === this.actor.userId && isEditableByRequester(pr.status)) {
      actions.push('update');
      if (this.actor.permissions.has(PERMISSIONS.PR_CREATE)) actions.push('submit');
      if (pr.status === 'draft' && pr.number === null) actions.push('delete');
    }
    if (steps.some((s) => s.canApprove)) actions.push('approve');
    if (steps.some((s) => s.canReject)) actions.push('reject');
    if (steps.some((s) => s.canReturn)) actions.push('return');
    if (steps.some((s) => s.canChangeBudgetLine)) actions.push('change_budget_line');
    if (isPending(pr.status) && this.actor.permissions.has(PERMISSIONS.PR_REASSIGN)) {
      actions.push('reassign');
    }
    return actions;
  }

  /** GET /prs/:id/steps/:stepId/eligible-users — who an open step can be reassigned to. */
  eligibleUsers(prId: string, stepId: string): Promise<PrEligibleUser[]> {
    return this.deps.run(async ({ prs, steps, routing }) => {
      if (!this.actor.permissions.has(PERMISSIONS.PR_REASSIGN)) {
        throw new AppError('FORBIDDEN', 'Missing permission pr:reassign');
      }
      const pr = await getPr(prs, prId);
      const step = (await steps.list(prId, pr.submissionCycle)).find((s) => s.id === stepId);
      if (!step || pr.requestingOfficeId === null) {
        throw new AppError('NOT_FOUND', 'pr_approval_step not found');
      }
      const users = await routing.eligibleUsers(
        {
          cycle: step.cycle,
          stepOrder: step.stepOrder,
          kind: step.kind,
          requiredRoleId: step.requiredRoleId,
          assignedUserId: null,
        },
        { id: pr.id, requesterId: pr.requesterId, requestingOfficeId: pr.requestingOfficeId }
      );
      const out: PrEligibleUser[] = [];
      for (const u of users) {
        const a = await prs.actor(u.userId);
        out.push({ userId: u.userId, nameAr: a.nameAr, nameEn: a.nameEn, position: a.position });
      }
      return out;
    });
  }

  // -------------------------------------------------------------------------------------------
  // Attachments
  // -------------------------------------------------------------------------------------------

  async createUploadUrl(prId: string, input: AttachmentUpload): Promise<AttachmentUploadTarget> {
    const attachment = await this.deps.run(async ({ prs, attachments }) => {
      const pr = await getPr(prs, prId, { lock: true });
      assertCreator(pr, this.actor);
      assertEditable(pr);
      assertAttachmentAllowed(input, (await attachments.list(prId)).length);
      const attachmentId = this.newId();
      return attachments.insert({
        id: attachmentId,
        prId,
        storagePath: `${this.actor.tenantId}/${prId}/${attachmentId}`,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      });
    });
    const target = await this.deps.storage.uploadUrl(attachment.storagePath);
    return { attachmentId: attachment.id, path: attachment.storagePath, ...target };
  }

  completeUpload(prId: string, attachmentId: string): Promise<PrAttachmentView> {
    return this.deps.run(async ({ prs, attachments }) => {
      const pr = await getPr(prs, prId, { lock: true });
      assertCreator(pr, this.actor);
      assertEditable(pr);
      const attachment = await this.getAttachment(attachments, prId, attachmentId);
      await attachments.markUploaded(attachment.id);
      return toAttachmentView((await attachments.find(prId, attachmentId))!);
    });
  }

  /** Soft delete; the stored object stays for the audit trail. */
  removeAttachment(prId: string, attachmentId: string): Promise<void> {
    return this.deps.run(async ({ prs, attachments }) => {
      const pr = await getPr(prs, prId, { lock: true });
      assertCreator(pr, this.actor);
      assertEditable(pr);
      const attachment = await this.getAttachment(attachments, prId, attachmentId);
      await attachments.softDelete(attachment.id);
    });
  }

  async downloadUrl(prId: string, attachmentId: string): Promise<{ url: string }> {
    const attachment = await this.deps.run(async ({ prs, attachments }) => {
      await getPr(prs, prId);
      const found = await this.getAttachment(attachments, prId, attachmentId);
      if (!found.uploadedAt) throw new AppError('NOT_FOUND', 'The file was not uploaded');
      return found;
    });
    return {
      url: await this.deps.storage.downloadUrl(attachment.storagePath, attachment.fileName),
    };
  }

  private async getAttachment(store: PrAttachmentStore, prId: string, id: string) {
    const attachment = await store.find(prId, id);
    if (!attachment || attachment.deletedAt)
      throw new AppError('NOT_FOUND', 'attachment not found');
    return attachment;
  }
}
