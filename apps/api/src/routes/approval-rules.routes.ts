import {
  PERMISSIONS,
  approvalRuleBody,
  approvalRuleListQuery,
  approvalRuleResolve,
  idParam,
  type ApprovalRuleBody,
  type ApprovalRuleResolve,
  type DoaType,
} from '@ngo/shared';
import { Router } from 'express';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { ApprovalRuleService } from '../services/approval-rule.service';

export function approvalRulesRouter(service = new ApprovalRuleService()): Router {
  const router = Router();
  const canManage = requirePermission(PERMISSIONS.SETTINGS_MANAGE);

  router.get(
    '/approval-rules',
    canManage,
    validate({ query: approvalRuleListQuery }),
    async (req, res, next) => {
      try {
        const { docType } = req.query as unknown as { docType: DoaType };
        res.json({ data: await service.list(req.ctx!, docType) });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    '/approval-rules/resolve',
    canManage,
    validate({ body: approvalRuleResolve }),
    async (req, res, next) => {
      try {
        res.json(await service.resolve(req.ctx!, req.body as ApprovalRuleResolve));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    '/approval-rules',
    canManage,
    validate({ body: approvalRuleBody }),
    async (req, res, next) => {
      try {
        res.status(201).json(await service.create(req.ctx!, req.body as ApprovalRuleBody));
      } catch (err) {
        next(err);
      }
    }
  );

  router.put(
    '/approval-rules/:id',
    canManage,
    validate({ params: idParam, body: approvalRuleBody }),
    async (req, res, next) => {
      try {
        const { id } = req.params as { id: string };
        res.json(await service.update(req.ctx!, id, req.body as ApprovalRuleBody));
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
