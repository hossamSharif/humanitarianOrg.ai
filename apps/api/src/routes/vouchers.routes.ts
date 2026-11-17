import {
  PERMISSIONS_002,
  generateVoucherBody,
  idParam,
  voucherCheckBody,
  voucherListQuery,
  voucherPostBody,
  voucherReverseBody,
  type DocTypeCode,
  type GenerateVoucherInput,
  type VoucherCheckInput,
  type VoucherDetail,
  type VoucherListQuery,
  type VoucherPostInput,
  type VoucherReverseInput,
  type VoucherType,
} from '@ngo/shared';
import { Router } from 'express';
import { AppError } from '../middleware/error';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { docWorkflowFor } from '../services/doc-adapters/binding';
import { voucherAdapter } from '../services/doc-adapters/voucher.adapter';
import { VoucherService } from '../services/voucher.service';
import type { RequestContext } from '../types/context';
import { documentActionsRouter } from './document-actions';
import { handle } from './route-helpers';

const voucherWorkflow = (ctx: RequestContext, type: VoucherType) =>
  docWorkflowFor(ctx, (tx) => voucherAdapter(tx, ctx, type));

/**
 * Vouchers (002 US13, contracts/rest-api.md "Accounting"): read with finance:read; generate
 * from an approved payment request with voucher:create; check (the `check` step, balance
 * enforced) and the approval steps by eligibility (voucher:check / voucher:approve) and
 * segregation (voucher_three_people); post with voucher:post; reverse with voucher:reverse. The
 * shared document actions serve every voucher type under `/vouchers`.
 */
export function vouchersRouter(service = new VoucherService()): Router {
  const router = Router();
  const canRead = requirePermission(PERMISSIONS_002.FINANCE_READ);

  /** The voucher with the caller's workflow steps and actions. */
  async function detail(
    ctx: RequestContext,
    id: string,
    body?: Omit<VoucherDetail, 'steps'>
  ): Promise<VoucherDetail> {
    const voucher = body ?? (await service.get(ctx, id));
    const { steps, availableActions } = await voucherWorkflow(ctx, voucher.type).describe(id);
    const actions = [...voucher.availableActions, ...availableActions];
    const current = steps.find((s) => s.status === 'pending');
    if (current?.kind === 'check' && current.canApprove) actions.push('check');
    return { ...voucher, steps, availableActions: [...new Set(actions)] };
  }

  router.get(
    '/vouchers',
    canRead,
    validate({ query: voucherListQuery }),
    handle(async (req, res, ctx) => {
      res.json(await service.list(ctx, req.query as unknown as VoucherListQuery));
    })
  );

  router.get(
    '/vouchers/:id',
    canRead,
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json(await detail(ctx, req.params.id!));
    })
  );

  router.post(
    '/payment-requests/:id/voucher',
    requirePermission(PERMISSIONS_002.VOUCHER_CREATE),
    validate({ params: idParam, body: generateVoucherBody }),
    handle(async (req, res, ctx) => {
      const created = await service.generateFromPaymentRequest(
        ctx,
        req.params.id!,
        req.body as GenerateVoucherInput
      );
      res.status(201).json(await detail(ctx, created.id, created));
    })
  );

  router.post(
    '/vouchers/:id/check',
    validate({ params: idParam, body: voucherCheckBody }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      const input = req.body as VoucherCheckInput;
      const workflow = voucherWorkflow(ctx, await service.typeOf(ctx, id));
      const { steps } = await workflow.describe(id);
      if (steps.find((s) => s.id === input.stepId)?.kind !== 'check') {
        throw new AppError('INVALID_STATE', 'The step is not the voucher check');
      }
      await workflow.approve(id, input);
      res.json(await detail(ctx, id));
    })
  );

  router.post(
    '/vouchers/:id/post',
    requirePermission(PERMISSIONS_002.VOUCHER_POST),
    validate({ params: idParam, body: voucherPostBody }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json(await detail(ctx, id, await service.post(ctx, id, req.body as VoucherPostInput)));
    })
  );

  router.post(
    '/vouchers/:id/reverse',
    requirePermission(PERMISSIONS_002.VOUCHER_REVERSE),
    validate({ params: idParam, body: voucherReverseBody }),
    handle(async (req, res, ctx) => {
      const created = await service.reverse(ctx, req.params.id!, req.body as VoucherReverseInput);
      res.status(201).json(await detail(ctx, created.id, created));
    })
  );

  router.use(
    documentActionsRouter({
      slug: 'vouchers',
      docType: (ctx, id) => service.typeOf(ctx, id) as Promise<DocTypeCode>,
      headerTable: 'voucher',
      read: PERMISSIONS_002.FINANCE_READ,
      create: PERMISSIONS_002.VOUCHER_CREATE,
      workflow: (ctx, docType) => voucherWorkflow(ctx, docType as VoucherType),
    })
  );

  return router;
}
