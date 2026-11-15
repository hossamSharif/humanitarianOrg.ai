import {
  docTypeParam,
  numberingConfigBody,
  numberingPreviewQuery,
  PERMISSIONS,
  type DocType,
  type NumberingConfigInput,
} from '@ngo/shared';
import { Router } from 'express';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { NumberingRepository } from '../repositories/numbering.repository';
import { NumberingService } from '../services/numbering.service';
import type { RequestContext } from '../types/context';

export type NumberingServiceFactory = (ctx: RequestContext) => NumberingService;

const defaultFactory: NumberingServiceFactory = (ctx) =>
  new NumberingService(new NumberingRepository(ctx));

/** GET / PUT /numbering/:docType (settings:manage); both return `preview`. */
export function numberingRouter(make: NumberingServiceFactory = defaultFactory): Router {
  const router = Router();

  router.get(
    '/numbering/:docType',
    requirePermission(PERMISSIONS.SETTINGS_MANAGE),
    validate({ params: docTypeParam, query: numberingPreviewQuery }),
    async (req, res, next) => {
      try {
        const { docType } = req.params as { docType: DocType };
        const { officeId } = req.query as { officeId?: string };
        res.json(await make(req.ctx!).get(docType, officeId));
      } catch (err) {
        next(err);
      }
    }
  );

  router.put(
    '/numbering/:docType',
    requirePermission(PERMISSIONS.SETTINGS_MANAGE),
    validate({ params: docTypeParam, query: numberingPreviewQuery, body: numberingConfigBody }),
    async (req, res, next) => {
      try {
        const { docType } = req.params as { docType: DocType };
        const { officeId } = req.query as { officeId?: string };
        res.json(await make(req.ctx!).update(docType, req.body as NumberingConfigInput, officeId));
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
