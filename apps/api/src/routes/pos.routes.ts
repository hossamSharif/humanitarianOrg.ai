import {
  PERMISSIONS_002,
  createPosBody,
  idParam,
  poAcknowledgeBody,
  poCloseBody,
  poListQuery,
  poPatchBody,
  poVersionParams,
  type CreatePosInput,
  type PoAcknowledgeInput,
  type PoCloseInput,
  type PoListQuery,
  type PoPatchInput,
  type PurchaseOrderDetail,
} from '@ngo/shared';
import { Router } from 'express';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { docWorkflowFor } from '../services/doc-adapters/binding';
import { poAdapter } from '../services/doc-adapters/po.adapter';
import { PurchaseOrderService } from '../services/purchase-order.service';
import type { RequestContext } from '../types/context';
import { documentActionsRouter } from './document-actions';
import { handle } from './route-helpers';

const poWorkflow = (ctx: RequestContext, docType: 'PO' | 'CON') =>
  docWorkflowFor(ctx, (tx) => poAdapter(tx, ctx, docType));

/**
 * Purchase orders and contracts (002 US6, contracts/rest-api.md "POs, contracts, amendments"):
 * read with procurement:read; create from an approved award, edit terms and acknowledge with
 * po:create; close with po:close; the shared document actions for the PO / CON route, whose
 * steps are decided by eligibility (po:approve) and segregation (creator_approves). `/contracts`
 * serves the same documents of kind `contract`.
 */
export function posRouter(service = new PurchaseOrderService()): Router {
  const router = Router();
  const canRead = requireAnyPermission(
    PERMISSIONS_002.PROCUREMENT_READ,
    PERMISSIONS_002.PO_CREATE,
    PERMISSIONS_002.GRN_CREATE,
    PERMISSIONS_002.GRN_INSPECT
  );
  const canCreate = requirePermission(PERMISSIONS_002.PO_CREATE);

  /** The PO with the caller's workflow steps and actions. */
  async function detail(
    ctx: RequestContext,
    id: string,
    body?: Omit<PurchaseOrderDetail, 'steps'>
  ): Promise<PurchaseOrderDetail> {
    const po = body ?? (await service.get(ctx, id));
    const { steps, availableActions } = await poWorkflow(ctx, po.docType).describe(id);
    return {
      ...po,
      steps,
      availableActions: [...new Set([...po.availableActions, ...availableActions])],
    };
  }

  router.post(
    '/bid-analyses/:id/pos',
    canCreate,
    validate({ params: idParam, body: createPosBody }),
    handle(async (req, res, ctx) => {
      const data = await service.createFromAnalysis(
        ctx,
        req.params.id!,
        req.body as CreatePosInput
      );
      res.status(201).json({ data });
    })
  );

  for (const slug of ['pos', 'contracts'] as const) {
    const kind = slug === 'pos' ? 'po' : 'contract';

    router.get(
      `/${slug}`,
      canRead,
      validate({ query: poListQuery }),
      handle(async (req, res, ctx) => {
        const query = req.query as unknown as PoListQuery;
        res.json(await service.list(ctx, { ...query, kind: query.kind ?? kind }));
      })
    );

    router.get(
      `/${slug}/:id`,
      canRead,
      validate({ params: idParam }),
      handle(async (req, res, ctx) => {
        res.json(await detail(ctx, req.params.id!));
      })
    );

    router.patch(
      `/${slug}/:id`,
      canCreate,
      validate({ params: idParam, body: poPatchBody }),
      handle(async (req, res, ctx) => {
        const id = req.params.id!;
        res.json(await detail(ctx, id, await service.patch(ctx, id, req.body as PoPatchInput)));
      })
    );

    router.post(
      `/${slug}/:id/acknowledge`,
      canCreate,
      validate({ params: idParam, body: poAcknowledgeBody }),
      handle(async (req, res, ctx) => {
        const id = req.params.id!;
        res.json(
          await detail(ctx, id, await service.acknowledge(ctx, id, req.body as PoAcknowledgeInput))
        );
      })
    );

    router.post(
      `/${slug}/:id/close`,
      requirePermission(PERMISSIONS_002.PO_CLOSE),
      validate({ params: idParam, body: poCloseBody }),
      handle(async (req, res, ctx) => {
        const id = req.params.id!;
        res.json(await detail(ctx, id, await service.close(ctx, id, req.body as PoCloseInput)));
      })
    );

    router.get(
      `/${slug}/:id/versions`,
      canRead,
      validate({ params: idParam }),
      handle(async (req, res, ctx) => {
        res.json({ data: await service.versions(ctx, req.params.id!) });
      })
    );

    router.get(
      `/${slug}/:id/versions/:v`,
      canRead,
      validate({ params: poVersionParams }),
      handle(async (req, res, ctx) => {
        const params = req.params as unknown as { id: string; v: number };
        res.json(await service.version(ctx, params.id, Number(params.v)));
      })
    );

    router.use(
      documentActionsRouter({
        slug,
        docType: () => (kind === 'po' ? 'PO' : 'CON'),
        headerTable: 'purchase_order',
        read: PERMISSIONS_002.PROCUREMENT_READ,
        create: PERMISSIONS_002.PO_CREATE,
        workflow: (ctx, docType) => poWorkflow(ctx, docType === 'CON' ? 'CON' : 'PO'),
      })
    );
  }

  return router;
}
