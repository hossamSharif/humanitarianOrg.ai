import {
  PERMISSIONS,
  budgetDrillDownParams,
  budgetDrillDownQuery,
  budgetStatusExportQuery,
  budgetStatusQuery,
  type BudgetDrillDownQuery,
  type BudgetStatusExportQuery,
  type BudgetStatusQuery,
} from '@ngo/shared';
import { Router } from 'express';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { ReportService } from '../services/report.service';
import { handle, type ServiceFactory } from './route-helpers';

/** Budget status report, drill-down and Excel export (FR-049); all need budget:read. */
export function reportsRouter(
  service: ServiceFactory<ReportService> = ReportService.forContext
): Router {
  const router = Router();
  const budgetRead = requirePermission(PERMISSIONS.BUDGET_READ);

  router.get(
    '/reports/budget-status',
    budgetRead,
    validate({ query: budgetStatusQuery }),
    handle(async (req, res, ctx) => {
      const { grantId } = req.query as unknown as BudgetStatusQuery;
      const { timeZone: _timeZone, ...report } = await service(ctx).budgetStatus(grantId);
      res.json(report);
    })
  );

  router.get(
    '/reports/budget-status/lines/:budgetLineId/prs',
    budgetRead,
    validate({ params: budgetDrillDownParams, query: budgetDrillDownQuery }),
    handle(async (req, res, ctx) => {
      const { status } = req.query as unknown as BudgetDrillDownQuery;
      res.json(await service(ctx).drillDown(req.params.budgetLineId!, status));
    })
  );

  router.get(
    '/reports/budget-status/export.xlsx',
    budgetRead,
    validate({ query: budgetStatusExportQuery }),
    handle(async (req, res, ctx) => {
      const { grantId, locale } = req.query as unknown as BudgetStatusExportQuery;
      const { fileName, content } = await service(ctx).exportXlsx(grantId, locale);
      res
        .status(200)
        .set({
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Cache-Control': 'no-store',
        })
        .send(content);
    })
  );

  return router;
}
