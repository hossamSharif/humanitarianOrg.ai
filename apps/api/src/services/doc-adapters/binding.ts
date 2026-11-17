// The stores a non-PR document's workflow commands use, bound to one transaction: steps and
// signatures in doc_approval_step / doc_signature, routing by the type's DoA rules, doc_*
// notifications and numbering by registry code. Before the first 002 command of an
// organization, its pending tenant seed hooks run (app.ensure_tenant_seeds: roles, numbering
// and DoA rules of 002, migration 0021).
import { withTenantTx, type TenantTx } from '../../db/tx';
import { ApprovalRuleRepository } from '../../repositories/approval-rule.repository';
import { DocApprovalStepRepository } from '../../repositories/doc-approval-step.repository';
import { DocSignatureRepository } from '../../repositories/doc-signature.repository';
import { NotificationRepository } from '../../repositories/notification.repository';
import { NumberingRepository } from '../../repositories/numbering.repository';
import { AppError } from '../../middleware/error';
import { ApprovalRoutingService } from '../approval-routing.service';
import { DocNotificationService, type DocOutcomeKind } from '../notification.service';
import { DocumentWorkflowService } from '../document-workflow.service';
import { NumberingService, numberingTxStore } from '../numbering.service';
import type { RequestContext } from '../../types/context';
import type { ActorSnapshot, DocAdapter, DocRef, WorkflowBinding, WorkflowDoc } from './types';

/** Runs the organization's pending seed hooks (cheap once they are applied). */
export async function ensureTenantSeeds(tx: TenantTx): Promise<void> {
  await tx.sql`select app.ensure_tenant_seeds()`;
}

async function actorSnapshot(
  tx: TenantTx,
  tenantId: string,
  userId: string
): Promise<ActorSnapshot> {
  const [row] = await tx.sql<
    { full_name_ar: string; full_name_en: string; position_title: string | null }[]
  >`
    select full_name_ar, full_name_en, position_title from public.membership
    where tenant_id = ${tenantId} and user_id = ${userId}`;
  if (!row) throw new AppError('FORBIDDEN', 'No membership in this organization');
  return { nameAr: row.full_name_ar, nameEn: row.full_name_en, position: row.position_title };
}

function notifiedDoc<D extends WorkflowDoc, S>(adapter: DocAdapter<D, S>, ref: DocRef) {
  return {
    ...ref,
    doc: ref.doc ?? { docType: adapter.docType, doaType: adapter.doaType },
  };
}

export function docBinding<D extends WorkflowDoc, S>(
  tx: TenantTx,
  tenantId: string,
  adapter: DocAdapter<D, S>,
  numbering: NumberingService
): WorkflowBinding<D, S> {
  const steps = new DocApprovalStepRepository(tx.sql, tenantId, adapter.docType);
  const signatures = new DocSignatureRepository(tx.sql, tenantId, adapter.docType);
  const routing = new ApprovalRoutingService(new ApprovalRuleRepository(tx.sql, tenantId));
  const notifications = new DocNotificationService(
    new NotificationRepository(tx.sql, tenantId),
    routing
  );

  return {
    adapter,
    steps: {
      list: (docId, cycle) => steps.list(docId, cycle),
      update: (id, changes) => steps.update(id, changes),
      cancelWaiting: (docId, cycle) => steps.cancelWaiting(docId, cycle),
      async materialise(docId, cycle, route) {
        const rows = route.steps.map((s, i) => ({
          cycle,
          stepOrder: s.stepOrder,
          kind: s.kind,
          requiredRoleId: s.roleId,
          ruleStepId: s.ruleStepId,
          status: (i === 0 ? 'pending' : 'waiting') as 'pending' | 'waiting',
        }));
        await steps.insertMany(docId, rows);
        return rows.map((r) => ({ stepOrder: r.stepOrder, kind: r.kind, status: r.status }));
      },
    },
    signatures: {
      insert: (row) => signatures.insert(row),
      list: (docId) => signatures.list(docId),
    },
    routing,
    notifier: {
      async stepEligible(doc, step, actorName) {
        await notifications.notifyStepEligible(notifiedDoc(adapter, doc), step, actorName);
      },
      creator: (doc, outcome, actorName) =>
        notifications.notifyCreator(
          notifiedDoc(adapter, doc),
          `doc_${outcome}` as DocOutcomeKind,
          actorName
        ),
      reassigned: (doc, step, userId, actorName) =>
        notifications.notifyReassigned(notifiedDoc(adapter, doc), step, userId, actorName),
    },
    actorSnapshot: (userId) => actorSnapshot(tx, tenantId, userId),
    setAuditComment: (comment) => tx.setAuditComment(comment),
    assignNumber: (docType, officeId, submittedAt, timeZone) =>
      numbering.assignNumber(tx.sql, docType, officeId, submittedAt, timeZone),
  };
}

/**
 * The workflow engine for a non-PR type: every command is one tenant transaction in which the
 * organization's pending seeds run first, then the type's adapter is built and bound.
 */
export function docWorkflowFor<D extends WorkflowDoc, S>(
  ctx: RequestContext,
  makeAdapter: (tx: TenantTx) => DocAdapter<D, S>
): DocumentWorkflowService<D, S> {
  const numbering = new NumberingService(
    new NumberingRepository(ctx),
    numberingTxStore(ctx.tenantId)
  );
  return new DocumentWorkflowService<D, S>({
    actor: { userId: ctx.userId, permissions: ctx.permissions },
    run: (fn) =>
      withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, async (tx) => {
        await ensureTenantSeeds(tx);
        return fn(docBinding(tx, ctx.tenantId, makeAdapter(tx), numbering), tx);
      }),
  });
}
