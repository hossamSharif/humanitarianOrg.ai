import {
  PERMISSIONS_002,
  createOrderPaymentBody,
  idParam,
  matchOverrideBody,
  paymentListQuery,
  paymentPatchBody,
  type CreateOrderPaymentInput,
  type MatchOverrideInput,
  type PaymentListQuery,
  type PaymentPatchInput,
  type PaymentRequestDetail,
} from '@ngo/shared';
import { Router } from 'express';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { docWorkflowFor } from '../services/doc-adapters/binding';
import { paymentRequestAdapter } from '../services/doc-adapters/payment-request.adapter';
import { PaymentRequestService } from '../services/payment-request.service';
import type { RequestContext } from '../types/context';
import { documentActionsRouter } from './document-actions';
import { handle } from './route-helpers';

const payWorkflow = (ctx: RequestContext) =>
  docWorkflowFor(ctx, (tx) => paymentRequestAdapter(tx, ctx));

/**
 * Payment requests against orders (002 US11, contracts/rest-api.md "Invoices and payment
 * requests"): read with finance:read or payment:create; create and edit with payment:create;
 * override a failed match with payment:override_match; the shared document actions of the PAY
 * route, whose steps are decided by eligibility (payment:check / payment:approve) and
 * segregation (preparer_approves_payment, receiver_approves_payment).
 */
export function paymentRequestsRouter(service = new PaymentRequestService()): Router {
  const router = Router();
  const canRead = requireAnyPermission(
    PERMISSIONS_002.FINANCE_READ,
    PERMISSIONS_002.PAYMENT_CREATE
  );
  const canCreate = requirePermission(PERMISSIONS_002.PAYMENT_CREATE);

  /** The request with the caller's workflow steps and actions. */
  async function detail(
    ctx: RequestContext,
    id: string,
    body?: Omit<PaymentRequestDetail, 'steps'>
  ): Promise<PaymentRequestDetail> {
    const request = body ?? (await service.get(ctx, id));
    const { steps, availableActions } = await payWorkflow(ctx).describe(id);
    return {
      ...request,
      steps,
      availableActions: [...new Set([...request.availableActions, ...availableActions])],
    };
  }

  router.post(
    '/pos/:id/payment-requests',
    canCreate,
    validate({ params: idParam, body: createOrderPaymentBody }),
    handle(async (req, res, ctx) => {
      const created = await service.create(
        ctx,
        req.params.id!,
        req.body as CreateOrderPaymentInput
      );
      res.status(201).json(await detail(ctx, created.id, created));
    })
  );

  router.get(
    '/payment-requests',
    canRead,
    validate({ query: paymentListQuery }),
    handle(async (req, res, ctx) => {
      res.json(await service.list(ctx, req.query as unknown as PaymentListQuery));
    })
  );

  router.get(
    '/payment-requests/:id',
    canRead,
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json(await detail(ctx, req.params.id!));
    })
  );

  router.patch(
    '/payment-requests/:id',
    canCreate,
    validate({ params: idParam, body: paymentPatchBody }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json(await detail(ctx, id, await service.patch(ctx, id, req.body as PaymentPatchInput)));
    })
  );

  router.post(
    '/payment-requests/:id/match-override',
    requirePermission(PERMISSIONS_002.PAYMENT_OVERRIDE_MATCH),
    validate({ params: idParam, body: matchOverrideBody }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json(
        await detail(ctx, id, await service.overrideMatch(ctx, id, req.body as MatchOverrideInput))
      );
    })
  );

  router.use(
    documentActionsRouter({
      slug: 'payment-requests',
      docType: () => 'PAY',
      headerTable: 'payment_request',
      read: PERMISSIONS_002.FINANCE_READ,
      create: PERMISSIONS_002.PAYMENT_CREATE,
      workflow: (ctx) => payWorkflow(ctx),
    })
  );

  return router;
}
