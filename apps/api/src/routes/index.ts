import { Router } from 'express';
import { activitiesRouter } from './activities.routes';
import { budgetLinesRouter } from './budget-lines.routes';
import { donorsRouter } from './donors.routes';
import { exchangeRatesRouter } from './exchange-rates.routes';
import { grantsRouter } from './grants.routes';

export const API_VERSION = process.env.npm_package_version ?? '0.1.0';

/** `/api/v1` routes that need the tenant context. Feature routers are mounted here (US1–US8). */
export function tenantRouter(): Router {
  const router = Router();
  router.use(donorsRouter());
  router.use(grantsRouter());
  router.use(budgetLinesRouter());
  router.use(activitiesRouter());
  router.use(exchangeRatesRouter());
  return router;
}

export function healthRouter(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: API_VERSION });
  });
  return router;
}
