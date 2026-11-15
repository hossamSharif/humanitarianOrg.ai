import { Router } from 'express';
import { approvalRulesRouter } from './approval-rules.routes';
import { rolesRouter } from './roles.routes';
import { usersRouter } from './users.routes';

export const API_VERSION = process.env.npm_package_version ?? '0.1.0';

/** `/api/v1` routes that need the tenant context. Feature routers are mounted here (US1–US8). */
export function tenantRouter(): Router {
  const router = Router();
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
