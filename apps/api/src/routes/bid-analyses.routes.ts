import {
  PERMISSIONS_002,
  analysisListQuery,
  analysisSignBody,
  committeeBody,
  createAnalysisBody,
  declarationBody,
  disqualifyBody,
  idParam,
  noticesBody,
  recommendationBody,
  scoresBody,
  type AnalysisListQuery,
  type AnalysisSignInput,
  type BidAnalysisDetail,
  type CommitteeInput,
  type CreateAnalysisInput,
  type DeclarationInput,
  type DisqualifyInput,
  type NoticesInput,
  type RecommendationInput,
  type ScoresInput,
} from '@ngo/shared';
import { Router } from 'express';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { AnalysisService } from '../services/analysis.service';
import { awardAdapter } from '../services/doc-adapters/award.adapter';
import { docWorkflowFor } from '../services/doc-adapters/binding';
import type { RequestContext } from '../types/context';
import { documentActionsRouter } from './document-actions';
import { handle } from './route-helpers';

const awardWorkflow = (ctx: RequestContext) => docWorkflowFor(ctx, (tx) => awardAdapter(tx, ctx));

/**
 * Quotation analyses and awards (002 US5, contracts/rest-api.md "Analysis and award"): read
 * with procurement:read; create, committee, recommendation and notices with rfq:create or
 * tender:manage; declarations by members; scores and disqualification with evaluation:score;
 * signatures with evaluation:sign; the shared document actions (submit … history) for the AWARD
 * route, whose steps are decided by eligibility (award:approve) and segregation.
 */
export function bidAnalysesRouter(service = new AnalysisService()): Router {
  const router = Router();
  const canRead = requireAnyPermission(
    PERMISSIONS_002.PROCUREMENT_READ,
    PERMISSIONS_002.RFQ_CREATE,
    PERMISSIONS_002.EVALUATION_SCORE
  );
  const canManage = requireAnyPermission(PERMISSIONS_002.RFQ_CREATE, PERMISSIONS_002.TENDER_MANAGE);

  /** The analysis with the caller's workflow steps and actions. */
  async function detail(
    ctx: RequestContext,
    id: string,
    body?: Omit<BidAnalysisDetail, 'steps'>
  ): Promise<BidAnalysisDetail> {
    const analysis = body ?? (await service.get(ctx, id));
    const { steps, availableActions } = await awardWorkflow(ctx).describe(id);
    return {
      ...analysis,
      steps,
      availableActions: [...new Set([...analysis.availableActions, ...availableActions])],
    };
  }

  router.get(
    '/bid-analyses',
    canRead,
    validate({ query: analysisListQuery }),
    handle(async (req, res, ctx) => {
      res.json(await service.list(ctx, req.query as unknown as AnalysisListQuery));
    })
  );

  router.post(
    '/bid-analyses',
    canManage,
    validate({ body: createAnalysisBody }),
    handle(async (req, res, ctx) => {
      const created = await service.create(ctx, req.body as CreateAnalysisInput);
      res.status(201).json(await detail(ctx, created.id, created));
    })
  );

  router.get(
    '/bid-analyses/:id',
    canRead,
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json(await detail(ctx, req.params.id!));
    })
  );

  router.put(
    '/bid-analyses/:id/committee',
    canManage,
    validate({ params: idParam, body: committeeBody }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json(
        await detail(ctx, id, await service.setCommittee(ctx, id, req.body as CommitteeInput))
      );
    })
  );

  router.post(
    '/bid-analyses/:id/declaration',
    canRead,
    validate({ params: idParam, body: declarationBody }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json(await detail(ctx, id, await service.declare(ctx, id, req.body as DeclarationInput)));
    })
  );

  router.put(
    '/bid-analyses/:id/scores',
    requirePermission(PERMISSIONS_002.EVALUATION_SCORE),
    validate({ params: idParam, body: scoresBody }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json(await detail(ctx, id, await service.putScores(ctx, id, req.body as ScoresInput)));
    })
  );

  router.post(
    '/bid-analyses/:id/disqualify',
    requirePermission(PERMISSIONS_002.EVALUATION_SCORE),
    validate({ params: idParam, body: disqualifyBody }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json(
        await detail(ctx, id, await service.disqualify(ctx, id, req.body as DisqualifyInput))
      );
    })
  );

  router.put(
    '/bid-analyses/:id/recommendation',
    canManage,
    validate({ params: idParam, body: recommendationBody }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json(
        await detail(ctx, id, await service.recommend(ctx, id, req.body as RecommendationInput))
      );
    })
  );

  router.post(
    '/bid-analyses/:id/sign',
    requirePermission(PERMISSIONS_002.EVALUATION_SIGN),
    validate({ params: idParam, body: analysisSignBody }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json(await detail(ctx, id, await service.sign(ctx, id, req.body as AnalysisSignInput)));
    })
  );

  router.post(
    '/bid-analyses/:id/notices',
    canManage,
    validate({ params: idParam, body: noticesBody }),
    handle(async (req, res, ctx) => {
      const id = req.params.id!;
      res.json(
        await detail(ctx, id, await service.recordNotices(ctx, id, req.body as NoticesInput))
      );
    })
  );

  router.use(
    documentActionsRouter({
      slug: 'bid-analyses',
      docType: () => 'QA',
      headerTable: 'bid_analysis',
      read: PERMISSIONS_002.PROCUREMENT_READ,
      create: PERMISSIONS_002.RFQ_CREATE,
      workflow: (ctx) => awardWorkflow(ctx),
    })
  );

  return router;
}
