import {
  PERMISSIONS,
  attachmentUpload,
  idParam,
  prApprove,
  prAttachmentParams,
  prCancel,
  prChangeBudgetLine,
  prCreate,
  prDraftUpdate,
  prLineParams,
  prPrintQuery,
  prReasonAction,
  prReassign,
  prStepParams,
  prSubmit,
  type AttachmentUpload,
  type PrApprove,
  type PrCancel,
  type PrChangeBudgetLine,
  type PrCreate,
  type PrDraftUpdate,
  type PrPrintQuery,
  type PrReasonAction,
  type PrReassign,
  type PrSubmit,
} from '@ngo/shared';
import { Router } from 'express';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { PrPrintService } from '../services/pr-print.service';
import { PrWorkflowService } from '../services/pr-workflow.service';
import { PrService } from '../services/pr.service';
import { handle, type ServiceFactory } from './route-helpers';

/**
 * Purchase requisitions. Reads need pr:read and are office-scoped by RLS; creating and
 * submitting need pr:create; draft edits, deletes and attachments are the requester's own
 * (checked by the service). Step actions (approve, reject, return, change budget line) need
 * eligibility for the current step, which the workflow service decides; reassigning needs
 * pr:reassign. Cancelling is the creator's before approval, or needs pr:cancel_approved
 * (decided by the workflow service per status).
 */
export function prsRouter(
  service: ServiceFactory<PrService> = PrService.forContext,
  workflow: ServiceFactory<PrWorkflowService> = PrWorkflowService.forContext,
  print: ServiceFactory<PrPrintService> = PrPrintService.forContext
): Router {
  const router = Router();
  const read = requirePermission(PERMISSIONS.PR_READ);
  const create = requirePermission(PERMISSIONS.PR_CREATE);
  const reassign = requirePermission(PERMISSIONS.PR_REASSIGN);

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

  // --- print (US7) ---------------------------------------------------------------------------

  router.get(
    '/prs/:id/print',
    read,
    validate({ params: idParam, query: prPrintQuery }),
    handle(async (req, res, ctx) => {
      const { locale } = req.query as unknown as PrPrintQuery;
      res.json(await print(ctx).printData(req.params.id!, locale));
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

  // --- steps (US5) ----------------------------------------------------------------------------

  router.post(
    '/prs/:id/approve',
    validate({ params: idParam, body: prApprove }),
    handle(async (req, res, ctx) => {
      res.json(await workflow(ctx).approve(req.params.id!, req.body as PrApprove));
    })
  );

  router.post(
    '/prs/:id/reject',
    validate({ params: idParam, body: prReasonAction }),
    handle(async (req, res, ctx) => {
      res.json(await workflow(ctx).reject(req.params.id!, req.body as PrReasonAction));
    })
  );

  router.post(
    '/prs/:id/return',
    validate({ params: idParam, body: prReasonAction }),
    handle(async (req, res, ctx) => {
      res.json(await workflow(ctx).return(req.params.id!, req.body as PrReasonAction));
    })
  );

  router.post(
    '/prs/:id/lines/:lineId/budget-line',
    validate({ params: prLineParams, body: prChangeBudgetLine }),
    handle(async (req, res, ctx) => {
      res.json(
        await workflow(ctx).changeBudgetLine(
          req.params.id!,
          req.params.lineId!,
          req.body as PrChangeBudgetLine
        )
      );
    })
  );

  router.get(
    '/prs/:id/steps/:stepId/eligible-users',
    reassign,
    validate({ params: prStepParams }),
    handle(async (req, res, ctx) => {
      res.json({ data: await service(ctx).eligibleUsers(req.params.id!, req.params.stepId!) });
    })
  );

  router.post(
    '/prs/:id/steps/:stepId/reassign',
    reassign,
    validate({ params: prStepParams, body: prReassign }),
    handle(async (req, res, ctx) => {
      res.json(
        await workflow(ctx).reassign(req.params.id!, req.params.stepId!, req.body as PrReassign)
      );
    })
  );

  // --- cancel (US6) ---------------------------------------------------------------------------

  router.post(
    '/prs/:id/cancel',
    validate({ params: idParam, body: prCancel }),
    handle(async (req, res, ctx) => {
      res.json(await workflow(ctx).cancel(req.params.id!, req.body as PrCancel));
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
