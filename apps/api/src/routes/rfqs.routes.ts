import {
  PERMISSIONS_002,
  createRfqBody,
  idParam,
  issueRfqBody,
  offerParams,
  offerReceiptBody,
  offerScanParams,
  offerScanUpload,
  offerTermsBody,
  openSourcingBody,
  rfqListQuery,
  rfqPrintQuery,
  sourceablePrLinesQuery,
  sourcingReasonBody,
  updateRfqBody,
  type CreateRfqInput,
  type IssueRfqInput,
  type OfferReceiptInput,
  type OfferScanUploadInput,
  type OfferTermsInput,
  type OpenSourcingInput,
  type RfqListQuery,
  type RfqPrintQuery,
  type SourceablePrLinesQuery,
  type SourcingReasonInput,
  type UpdateRfqInput,
} from '@ngo/shared';
import { Router } from 'express';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { DocHistoryService } from '../services/doc-history.service';
import { OpeningService } from '../services/opening.service';
import { RfqPrintService } from '../services/print/rfq-print.service';
import { SourcingService } from '../services/sourcing.service';
import { handle, type ServiceFactory } from './route-helpers';

/**
 * Requests for quotation (002 US3, US4, contracts/rest-api.md "RFQs and tenders"): read with
 * procurement:read (or rfq:create); draft, edit, cancel, re-issue and receipts with rfq:create;
 * issue with rfq:issue; the opening, terms, prices and scans with rfq:open. Routes validate and
 * delegate; the sourcing and opening services hold every rule.
 */
export function rfqsRouter(
  service = new SourcingService('rfq'),
  opening = new OpeningService('rfq'),
  print: ServiceFactory<RfqPrintService> = RfqPrintService.forContext,
  history: ServiceFactory<DocHistoryService> = DocHistoryService.forContext
): Router {
  const router = Router();
  const canRead = requireAnyPermission(
    PERMISSIONS_002.PROCUREMENT_READ,
    PERMISSIONS_002.RFQ_CREATE
  );
  const canCreate = requirePermission(PERMISSIONS_002.RFQ_CREATE);

  router.get(
    '/sourcing/pr-lines',
    canCreate,
    validate({ query: sourceablePrLinesQuery }),
    handle(async (req, res, ctx) => {
      res.json({
        data: await service.sourceablePrLines(ctx, req.query as unknown as SourceablePrLinesQuery),
      });
    })
  );

  router.get(
    '/rfqs',
    canRead,
    validate({ query: rfqListQuery }),
    handle(async (req, res, ctx) => {
      res.json(await service.list(ctx, req.query as unknown as RfqListQuery));
    })
  );

  router.post(
    '/rfqs',
    canCreate,
    validate({ body: createRfqBody }),
    handle(async (req, res, ctx) => {
      res.status(201).json(await service.create(ctx, req.body as CreateRfqInput));
    })
  );

  router.get(
    '/rfqs/:id',
    canRead,
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json(await service.get(ctx, req.params.id!));
    })
  );

  router.patch(
    '/rfqs/:id',
    canCreate,
    validate({ params: idParam, body: updateRfqBody }),
    handle(async (req, res, ctx) => {
      res.json(await service.update(ctx, req.params.id!, req.body as UpdateRfqInput));
    })
  );

  router.post(
    '/rfqs/:id/issue',
    requirePermission(PERMISSIONS_002.RFQ_ISSUE),
    validate({ params: idParam, body: issueRfqBody }),
    handle(async (req, res, ctx) => {
      res.json(await service.issue(ctx, req.params.id!, req.body as IssueRfqInput));
    })
  );

  router.post(
    '/rfqs/:id/cancel',
    canCreate,
    validate({ params: idParam, body: sourcingReasonBody }),
    handle(async (req, res, ctx) => {
      res.json(await service.cancel(ctx, req.params.id!, req.body as SourcingReasonInput));
    })
  );

  router.post(
    '/rfqs/:id/reissue',
    canCreate,
    validate({ params: idParam, body: sourcingReasonBody }),
    handle(async (req, res, ctx) => {
      res
        .status(201)
        .json(await service.reissue(ctx, req.params.id!, req.body as SourcingReasonInput));
    })
  );

  // --- receipts, opening, sealed terms (US4) -------------------------------------------------

  const canOpen = requirePermission(PERMISSIONS_002.RFQ_OPEN);

  router.post(
    '/rfqs/:id/offers',
    canCreate,
    validate({ params: idParam, body: offerReceiptBody }),
    handle(async (req, res, ctx) => {
      res
        .status(201)
        .json(await opening.logReceipt(ctx, req.params.id!, req.body as OfferReceiptInput));
    })
  );

  router.post(
    '/rfqs/:id/open',
    canOpen,
    validate({ params: idParam, body: openSourcingBody }),
    handle(async (req, res, ctx) => {
      res.json(await opening.open(ctx, req.params.id!, req.body as OpenSourcingInput));
    })
  );

  router.get(
    '/rfqs/:id/offer-terms',
    canRead,
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json({ data: await opening.listTerms(ctx, req.params.id!) });
    })
  );

  router.put(
    '/rfqs/:id/offers/:offerId/terms',
    canOpen,
    validate({ params: offerParams, body: offerTermsBody }),
    handle(async (req, res, ctx) => {
      res.json(
        await opening.enterTerms(
          ctx,
          req.params.id!,
          req.params.offerId!,
          req.body as OfferTermsInput
        )
      );
    })
  );

  router.post(
    '/rfqs/:id/offers/:offerId/scan-upload-url',
    canOpen,
    validate({ params: offerParams, body: offerScanUpload }),
    handle(async (req, res, ctx) => {
      res
        .status(201)
        .json(
          await opening.scanUploadUrl(
            ctx,
            req.params.id!,
            req.params.offerId!,
            req.body as OfferScanUploadInput
          )
        );
    })
  );

  router.post(
    '/rfqs/:id/offers/:offerId/scan/:attId/complete',
    canOpen,
    validate({ params: offerScanParams }),
    handle(async (req, res, ctx) => {
      res.json(
        await opening.completeScan(ctx, req.params.id!, req.params.offerId!, req.params.attId!)
      );
    })
  );

  router.get(
    '/rfqs/:id/offers/:offerId/scan-url',
    canRead,
    validate({ params: offerParams }),
    handle(async (req, res, ctx) => {
      res.json(await opening.scanUrl(ctx, req.params.id!, req.params.offerId!));
    })
  );

  router.get(
    '/rfqs/:id/history',
    canRead,
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json({ data: await history(ctx).history('RFQ', req.params.id!, 'sourcing_event') });
    })
  );

  router.get(
    '/rfqs/:id/print',
    canRead,
    validate({ params: idParam, query: rfqPrintQuery }),
    handle(async (req, res, ctx) => {
      const query = req.query as unknown as RfqPrintQuery;
      res.json(await print(ctx).printData(req.params.id!, query.supplierId, query.locale));
    })
  );

  return router;
}
