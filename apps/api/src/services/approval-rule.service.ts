// Approval rule configuration (FR-019, FR-035; 002: every DoA type) and the admin route preview. Structure is checked
// by the routing service before writing; roles and the office must belong to the tenant.
// Editing a rule never changes in-flight PRs: their routes are materialised (FR-005).
import {
  DOC_TYPE_CODES,
  DOC_TYPE_DOA,
  type ApprovalRule,
  type ApprovalRuleBody,
  type ApprovalRuleIssue,
  type ApprovalRuleResolve,
  type DoaType,
  type DocTypeCode,
  type ResolvedRoute,
} from '@ngo/shared';
import { withTenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import { ApprovalRuleRepository } from '../repositories/approval-rule.repository';
import { RoleRepository } from '../repositories/role.repository';
import type { RequestContext } from '../types/context';
import { ApprovalRoutingService, validateRule } from './approval-routing.service';

export interface ApprovalRuleRepos {
  rules: ApprovalRuleRepository;
  roles: RoleRepository;
}

export interface ApprovalRuleServiceDeps {
  run<T>(ctx: RequestContext, fn: (repos: ApprovalRuleRepos) => Promise<T>): Promise<T>;
}

export const defaultApprovalRuleDeps: ApprovalRuleServiceDeps = {
  run: (ctx, fn) =>
    withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, ({ sql }) =>
      fn({
        rules: new ApprovalRuleRepository(sql, ctx.tenantId),
        roles: new RoleRepository(sql, ctx.tenantId),
      })
    ),
};

async function assertReferences(repos: ApprovalRuleRepos, body: ApprovalRuleBody): Promise<void> {
  const issues: ApprovalRuleIssue[] = [];
  if (body.officeId && !(await repos.rules.officeExists(body.officeId))) {
    issues.push({ reason: 'office_not_found' });
  }
  const found = await repos.roles.existingIds([...new Set(body.steps.map((s) => s.roleId))]);
  for (const step of body.steps) {
    if (!found.has(step.roleId))
      issues.push({ reason: 'role_not_found', stepOrder: step.stepOrder });
  }
  if (issues.length) {
    throw new AppError('APPROVAL_RULE_INVALID', 'The approval rule is not valid', { issues });
  }
}

/** The document code a DoA type's preview is checked as (segregation needs one). */
function docTypeFor(doaType: DoaType): DocTypeCode {
  return DOC_TYPE_CODES.find((code) => DOC_TYPE_DOA[code] === doaType) ?? 'PR';
}

export class ApprovalRuleService {
  constructor(private readonly deps: ApprovalRuleServiceDeps = defaultApprovalRuleDeps) {}

  list(ctx: RequestContext, docType: DoaType = 'PR'): Promise<ApprovalRule[]> {
    return this.deps.run(ctx, ({ rules }) => rules.list(docType));
  }

  create(ctx: RequestContext, body: ApprovalRuleBody): Promise<ApprovalRule> {
    validateRule(body.steps, body.docType);
    return this.deps.run(ctx, async (repos) => {
      await assertReferences(repos, body);
      const id = await repos.rules.insert(body, body.steps);
      return repos.rules.getById(id);
    });
  }

  update(ctx: RequestContext, id: string, body: ApprovalRuleBody): Promise<ApprovalRule> {
    validateRule(body.steps, body.docType);
    return this.deps.run(ctx, async (repos) => {
      const current = await repos.rules.getById(id);
      if (current.docType !== body.docType) {
        throw new AppError('VALIDATION_ERROR', 'The document type of a rule cannot change', [
          { field: 'body.docType', message: 'immutable' },
        ]);
      }
      await assertReferences(repos, body);
      await repos.rules.replace(id, body, body.steps);
      return repos.rules.getById(id);
    });
  }

  /** The route a PR for `officeId` and `amount` would take now, with eligible counts. */
  resolve(ctx: RequestContext, body: ApprovalRuleResolve): Promise<ResolvedRoute> {
    return this.deps.run(ctx, async ({ rules }) => {
      if (!(await rules.officeExists(body.officeId))) {
        throw new AppError('NOT_FOUND', 'Office not found');
      }
      const routing = new ApprovalRoutingService(rules);
      const route = await routing.resolveRoute(body.officeId, body.amount, body.docType);
      // preview: no document yet, so no creator and no signatures to exclude
      const counts = await routing.eligibleCounts(
        route,
        {
          id: null,
          requesterId: null,
          requestingOfficeId: body.officeId,
          ...(body.docType === 'PR'
            ? {}
            : { doc: { docType: docTypeFor(body.docType), doaType: body.docType } }),
        },
        1
      );
      const names = await rules.roleNames(route.steps.map((s) => s.roleId));
      return {
        docType: body.docType,
        ruleId: route.ruleId,
        ruleName: route.ruleName,
        officeId: route.officeId,
        amount: body.amount,
        currency: await rules.doaReferenceCurrency(),
        steps: route.steps.map((s, i) => ({
          stepOrder: s.stepOrder,
          kind: s.kind,
          roleId: s.roleId,
          roleNameAr: names.get(s.roleId)?.nameAr ?? '',
          roleNameEn: names.get(s.roleId)?.nameEn ?? '',
          ruleStepId: s.ruleStepId,
          minAmount: s.minAmount,
          maxAmount: s.maxAmount,
          eligibleCount: counts[i] ?? 0,
        })),
      };
    });
  }
}
