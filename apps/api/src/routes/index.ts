import { Router } from 'express';
import { numberingRouter } from './numbering.routes';
import { officesRouter } from './offices.routes';
import { tenantProfileRouter } from './tenant.routes';
import { unitsRouter } from './units.routes';
import { activitiesRouter } from './activities.routes';
import { budgetLinesRouter } from './budget-lines.routes';
import { donorsRouter } from './donors.routes';
import { exchangeRatesRouter } from './exchange-rates.routes';
import { grantsRouter } from './grants.routes';
import { approvalRulesRouter } from './approval-rules.routes';
import { rolesRouter } from './roles.routes';
import { usersRouter } from './users.routes';

export const API_VERSION = process.env.npm_package_version ?? '0.1.0';

/** `/api/v1` routes that need the tenant context. Feature routers are mounted here (US1–US8). */
export function tenantRouter(): Router {
  const router = Router();
  router.use(tenantProfileRouter());
  router.use(officesRouter());
  router.use(unitsRouter());
  router.use(numberingRouter());
  router.use(donorsRouter());
  router.use(grantsRouter());
  router.use(budgetLinesRouter());
  router.use(activitiesRouter());
  router.use(exchangeRatesRouter());
  router.use(usersRouter());
  router.use(rolesRouter());
  router.use(approvalRulesRouter());
  return router;
}

export function healthRouter(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: API_VERSION });
  });
  return router;
}
