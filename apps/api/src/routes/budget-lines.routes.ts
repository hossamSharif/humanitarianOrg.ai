import {
  IMPORT_MAX_BYTES,
  PERMISSIONS,
  budgetLineCreate,
  budgetLineUpdate,
  idParam,
  importModeQuery,
  type BudgetLineCreate,
  type BudgetLineUpdate,
} from '@ngo/shared';
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import type { z } from 'zod';
import { AppError } from '../middleware/error';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { BudgetImportService } from '../services/budget-import.service';
import { BudgetService } from '../services/budget.service';
import { handle, type ServiceFactory } from './route-helpers';

/** One multipart `file` field, kept in memory (≤ 5 MB). */
const singleFile: RequestHandler = (req, res, next) => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: IMPORT_MAX_BYTES, files: 1, fields: 5 },
  }).single('file');
  upload(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const tooLarge = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
    next(
      new AppError('VALIDATION_ERROR', tooLarge ? 'File too large' : 'Invalid upload', [
        { field: 'file', message: tooLarge ? 'too_large' : 'invalid_upload' },
      ])
    );
  });
};

const importQuery = importModeQuery;

/**
 * Budget lines with derived figures; create, edit (amount edits locked, FR-014) and spreadsheet
 * import with grants:manage. Reads are open to members.
 */
export function budgetLinesRouter(
  service: ServiceFactory<BudgetService> = BudgetService.forContext,
  importService: ServiceFactory<BudgetImportService> = BudgetImportService.forContext
): Router {
  const router = Router();

  router.get(
    '/grants/:id/budget-lines',
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).list(req.params.id!));
    })
  );

  router.post(
    '/grants/:id/budget-lines/import',
    requirePermission(PERMISSIONS.GRANTS_MANAGE),
    validate({ params: idParam, query: importQuery }),
    singleFile,
    handle(async (req, res, ctx) => {
      const file = req.file;
      if (!file) {
        throw new AppError('VALIDATION_ERROR', 'A file is required', [
          { field: 'file', message: 'required' },
        ]);
      }
      const upload = {
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      };
      const { mode } = req.query as unknown as z.infer<typeof importQuery>;
      const importer = importService(ctx);
      if (mode === 'commit') {
        res.status(201).json(await importer.commit(req.params.id!, upload));
      } else {
        res.json(await importer.preview(req.params.id!, upload));
      }
    })
  );

  router.post(
    '/grants/:id/budget-lines',
    requirePermission(PERMISSIONS.GRANTS_MANAGE),
    validate({ params: idParam, body: budgetLineCreate }),
    handle(async (req, res, ctx) => {
      res.status(201).json(await service(ctx).create(req.params.id!, req.body as BudgetLineCreate));
    })
  );

  router.get(
    '/budget-lines/:id',
    validate({ params: idParam }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).get(req.params.id!));
    })
  );

  router.patch(
    '/budget-lines/:id',
    requirePermission(PERMISSIONS.GRANTS_MANAGE),
    validate({ params: idParam, body: budgetLineUpdate }),
    handle(async (req, res, ctx) => {
      res.json(await service(ctx).update(req.params.id!, req.body as BudgetLineUpdate));
    })
  );

  return router;
}
