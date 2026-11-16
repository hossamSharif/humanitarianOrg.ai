import {
  PERMISSIONS,
  attachmentUpload,
  idParam,
  prAttachmentParams,
  prCreate,
  prDraftUpdate,
  prSubmit,
  type AttachmentUpload,
  type PrCreate,
  type PrDraftUpdate,
  type PrSubmit,
} from '@ngo/shared';
import { Router } from 'express';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { PrWorkflowService } from '../services/pr-workflow.service';
import { PrService } from '../services/pr.service';
import { handle, type ServiceFactory } from './route-helpers';

/**
 * Purchase requisitions. Reads need pr:read and are office-scoped by RLS; creating and
 * submitting need pr:create; draft edits, deletes and attachments are the requester's own
 * (checked by the service).
 */
export function prsRouter(
  service: ServiceFactory<PrService> = PrService.forContext,
  workflow: ServiceFactory<PrWorkflowService> = PrWorkflowService.forContext
): Router {
  const router = Router();
  const read = requirePermission(PERMISSIONS.PR_READ);
  const create = requirePermission(PERMISSIONS.PR_CREATE);

  router.post(
    '/prs',
    create,
    validate({ body: prCreate }),
    handle(async (req, res, ctx) => {
      res.status(201).json(await service(ctx).createDraft(req.body as PrCreate));
    })
  );

  router.get(
    '/prs/:id',
    read,
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).getDetail(req.params.id!));
    })
  );

  router.patch(
    '/prs/:id',
    validate({ params: idParam, body: prDraftUpdate }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).updateDraft(req.params.id!, req.body as PrDraftUpdate));
    })
  );

  router.delete(
    '/prs/:id',
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      await service(ctx).deleteDraft(req.params.id!);
      res.status(204).end();
    })
  );

  router.post(
    '/prs/:id/submit',
    create,
    validate({ params: idParam, body: prSubmit }),
    handle(async (req, res, ctx) => {
      res.json(await workflow(ctx).submit(req.params.id!, req.body as PrSubmit));
    })
  );

  // --- attachments ----------------------------------------------------------------------------

  router.post(
    '/prs/:id/attachments/upload-url',
    validate({ params: idParam, body: attachmentUpload }),
    handle(async (req, res, ctx) => {
      res
        .status(201)
        .json(await service(ctx).createUploadUrl(req.params.id!, req.body as AttachmentUpload));
    })
  );

  router.post(
    '/prs/:id/attachments/:attId/complete',
    validate({ params: prAttachmentParams }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).completeUpload(req.params.id!, req.params.attId!));
    })
  );

  router.delete(
    '/prs/:id/attachments/:attId',
    validate({ params: prAttachmentParams }),
    handle(async (req, res, ctx) => {
      await service(ctx).removeAttachment(req.params.id!, req.params.attId!);
      res.status(204).end();
    })
  );

  router.get(
    '/prs/:id/attachments/:attId/url',
    read,
    validate({ params: prAttachmentParams }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).downloadUrl(req.params.id!, req.params.attId!));
    })
  );

  return router;
}
