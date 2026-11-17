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
import { prsRouter } from './prs.routes';
import { notificationsRouter } from './notifications.routes';
import { reportsRouter } from './reports.routes';
import { procurementSettingsRouter } from './procurement-settings.routes';
import { suppliersRouter } from './suppliers.routes';
import { staffPayeesRouter } from './staff-payees.routes';
import { rfqsRouter } from './rfqs.routes';
import { bidAnalysesRouter } from './bid-analyses.routes';
import { posRouter } from './pos.routes';
import { grnsRouter } from './grns.routes';

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
  router.use(prsRouter());
  router.use(notificationsRouter());
  router.use(reportsRouter());
  router.use(procurementSettingsRouter());
  router.use(suppliersRouter());
  router.use(staffPayeesRouter());
  router.use(rfqsRouter());
  router.use(bidAnalysesRouter());
  router.use(posRouter());
  router.use(grnsRouter());
  return router;
}

export function healthRouter(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: API_VERSION });
  });
  return router;
}
