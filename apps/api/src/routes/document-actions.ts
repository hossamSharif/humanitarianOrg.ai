// The shared action set of every approvable 002 document (contracts/rest-api.md "Shared
// document actions"), mounted per doc slug by that type's router: submit, approve, reject,
// return, cancel, reassign, history, trail and attachments. Routes validate and delegate; the
// workflow engine decides eligibility and segregation, the attachment service the lock rule.
import {
  docApprove,
  docAttachmentParams,
  docAttachmentUpload,
  docCancel,
  docReasonAction,
  docReassign,
  docStepParams,
  docSubmit,
  idParam,
  type DocApprove,
  type DocAttachmentUpload,
  type DocCancel,
  type DocReasonAction,
  type DocReassign,
  type DocSubmit,
  type DocTypeCode,
  type DocTypeSlug,
  type Permission,
} from '@ngo/shared';
import { Router } from 'express';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { DocAttachmentService } from '../services/doc-attachment.service';
import { DocHistoryService } from '../services/doc-history.service';
import type { DocumentWorkflowService } from '../services/document-workflow.service';
import type { WorkflowDoc } from '../services/doc-adapters/types';
import type { RequestContext } from '../types/context';
import { handle, type ServiceFactory } from './route-helpers';

export interface DocumentActionsConfig<D extends WorkflowDoc, S> {
  slug: DocTypeSlug;
  /** the code of the document behind `:id` (vouchers serve several codes under one slug) */
  docType(ctx: RequestContext, id: string): Promise<DocTypeCode> | DocTypeCode;
  /** the header table, for the history's from → to states */
  headerTable: string;
  read: Permission;
  /** creating and submitting (step actions are decided by eligibility) */
  create: Permission;
  workflow: (ctx: RequestContext, docType: DocTypeCode) => DocumentWorkflowService<D, S>;
  history?: ServiceFactory<DocHistoryService>;
  attachments?: ServiceFactory<DocAttachmentService>;
}

export function documentActionsRouter<D extends WorkflowDoc, S>(
  config: DocumentActionsConfig<D, S>
): Router {
  const router = Router();
  const base = `/${config.slug}/:id`;
  const read = requirePermission(config.read);
  const create = requirePermission(config.create);
  const history = config.history ?? DocHistoryService.forContext;
  const attachments = config.attachments ?? DocAttachmentService.forContext;
  const engine = async (ctx: RequestContext, id: string) =>
    config.workflow(ctx, await config.docType(ctx, id));

  router.post(
    `${base}/submit`,
    create,
    validate({ params: idParam, body: docSubmit }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      const outcome = await (await engine(ctx, id)).submit(id, req.body as DocSubmit);
      res.json({
        id,
        docType: await config.docType(ctx, id),
        status: outcome.status,
        version: outcome.version,
        number: outcome.number,
        currentStepOrder: outcome.steps[0]?.stepOrder ?? null,
        steps: outcome.steps,
      });
    })
  );

  router.post(
    `${base}/approve`,
    validate({ params: idParam, body: docApprove }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json(await (await engine(ctx, id)).approve(id, req.body as DocApprove));
    })
  );

  for (const action of ['reject', 'return'] as const) {
    router.post(
      `${base}/${action}`,
      validate({ params: idParam, body: docReasonAction }),
      handle(async (req, res, ctx) => {
        const id = req.params.id!;
        res.json(await (await engine(ctx, id))[action](id, req.body as DocReasonAction));
      })
    );
  }

  router.post(
    `${base}/cancel`,
    validate({ params: idParam, body: docCancel }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json(await (await engine(ctx, id)).cancel(id, req.body as DocCancel));
    })
  );

  router.post(
    `${base}/steps/:stepId/reassign`,
    validate({ params: docStepParams, body: docReassign }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json(
        await (await engine(ctx, id)).reassign(id, req.params.stepId!, req.body as DocReassign)
      );
    })
  );

  router.get(
    `${base}/steps/:stepId/eligible-users`,
    read,
    validate({ params: docStepParams }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json({ data: await (await engine(ctx, id)).eligibleUsers(id, req.params.stepId!) });
    })
  );

  router.get(
    `${base}/history`,
    read,
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      const docType = await config.docType(ctx, id);
      res.json({ data: await history(ctx).history(docType, id, config.headerTable) });
    })
  );

  // The document trail arrives with US19 (`GET /trail/:docType/:id`); until then the alias
  // answers with the document alone.
  router.get(
    `${base}/trail`,
    read,
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json({ nodes: [{ docType: await config.docType(ctx, id), id, depth: 0 }], edges: [] });
    })
  );

  // --- attachments (R31) ---------------------------------------------------------------------

  router.get(
    `${base}/attachments`,
    read,
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json({ data: await attachments(ctx).list(await config.docType(ctx, id), id) });
    })
  );

  router.post(
    `${base}/attachments/upload-url`,
    read,
    validate({ params: idParam, body: docAttachmentUpload }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res
        .status(201)
        .json(
          await attachments(ctx).createUploadUrl(
            await config.docType(ctx, id),
            id,
            req.body as DocAttachmentUpload
          )
        );
    })
  );

  router.post(
    `${base}/attachments/:attId/complete`,
    read,
    validate({ params: docAttachmentParams }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json(
        await attachments(ctx).completeUpload(await config.docType(ctx, id), id, req.params.attId!)
      );
    })
  );

  router.delete(
    `${base}/attachments/:attId`,
    read,
    validate({ params: docAttachmentParams }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      await attachments(ctx).remove(await config.docType(ctx, id), id, req.params.attId!);
      res.status(204).end();
    })
  );

  router.get(
    `${base}/attachments/:attId/url`,
    read,
    validate({ params: docAttachmentParams }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json(
        await attachments(ctx).downloadUrl(await config.docType(ctx, id), id, req.params.attId!)
      );
    })
  );

  return router;
}
