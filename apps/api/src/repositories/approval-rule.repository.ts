// PR approval rules and their steps (data-model §2, research R8), and the reads the routing
// service needs (ApprovalRoutingStore). Runs inside withTenantTx: a rule's steps are replaced as
// a whole, and migration 0011 checks the result at commit.
import type {
  ApprovalRule,
  DoaType,
  DocStepKind,
  DocTypeCode,
  MembershipStatus,
  Permission,
} from '@ngo/shared';
import type postgres from 'postgres';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';
import type {
  ApprovalRoutingStore,
  Candidate,
  PrStepWriter,
  RoleName,
  RuleLike,
  RuleStepDraft,
  Signature,
} from '../services/approval-routing.service';

type Fragment = postgres.PendingQuery<postgres.Row[]>;
export interface RuleValues {
  officeId: string | null;
  name: string;
  isActive: boolean;
}

interface RuleRow {
  id: string;
  doc_type: DoaType;
  office_id: string | null;
  name: string;
  is_active: boolean;
  steps: {
    id: string;
    stepOrder: number;
    kind: DocStepKind;
    roleId: string;
    minAmount: string | null;
    maxAmount: string | null;
  }[];
}

/** PR rules as the 001 rules API shows them (only PR kinds occur in PR rules). */
function toRule(r: RuleRow): ApprovalRule {
  return {
    id: r.id,
    docType: 'PR',
    officeId: r.office_id,
    name: r.name,
    isActive: r.is_active,
    steps: r.steps as ApprovalRule['steps'],
  };
}

function toRuleLike(r: RuleRow): RuleLike {
  return { id: r.id, name: r.name, officeId: r.office_id, isActive: r.is_active, steps: r.steps };
}

export class ApprovalRuleRepository implements ApprovalRoutingStore {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  private select(where: Fragment, doaType: DoaType = 'PR') {
    // amounts leave as text so no float rounding can creep in
    return this.sql<RuleRow[]>`
      select r.id, r.doc_type, r.office_id, r.name, r.is_active,
             coalesce((
               select jsonb_agg(
                 jsonb_build_object(
                   'id', s.id, 'stepOrder', s.step_order, 'kind', s.kind, 'roleId', s.role_id,
                   'minAmount', s.min_amount::text, 'maxAmount', s.max_amount::text)
                 order by s.step_order, s.min_amount nulls first)
               from public.approval_rule_step s where s.rule_id = r.id
             ), '[]'::jsonb) as steps
      from public.approval_rule r
      where r.tenant_id = ${this.tenantId} and r.doc_type = ${doaType} ${where}
      order by r.office_id nulls first, r.name`;
  }

  async list(): Promise<ApprovalRule[]> {
    return (await this.select(this.sql``)).map(toRule);
  }

  /** PR rules for the 001 callers; any DoA type for the document workflow (002). */
  async listRules(doaType: DoaType = 'PR'): Promise<RuleLike[]> {
    return (await this.select(this.sql``, doaType)).map(toRuleLike);
  }

  async findById(id: string): Promise<ApprovalRule | null> {
    const [row] = await this.select(this.sql`and r.id = ${id}`);
    return row ? toRule(row) : null;
  }

  async getById(id: string): Promise<ApprovalRule> {
    const rule = await this.findById(id);
    if (!rule) throw new AppError('NOT_FOUND', 'Approval rule not found');
    return rule;
  }

  async insert(values: RuleValues, steps: readonly RuleStepDraft[]): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.approval_rule (tenant_id, doc_type, office_id, name, is_active)
      values (${this.tenantId}, 'PR', ${values.officeId}, ${values.name}, ${values.isActive})
      returning id`;
    await this.insertSteps(row!.id, steps);
    return row!.id;
  }

  /** Full replace of the rule row and its steps. */
  async replace(id: string, values: RuleValues, steps: readonly RuleStepDraft[]): Promise<void> {
    const rows = await this.sql`
      update public.approval_rule
      set office_id = ${values.officeId}, name = ${values.name}, is_active = ${values.isActive}
      where tenant_id = ${this.tenantId} and id = ${id}
      returning id`;
    if (rows.length === 0) throw new AppError('NOT_FOUND', 'Approval rule not found');
    await this.sql`
      delete from public.approval_rule_step where tenant_id = ${this.tenantId} and rule_id = ${id}`;
    await this.insertSteps(id, steps);
  }

  private async insertSteps(ruleId: string, steps: readonly RuleStepDraft[]): Promise<void> {
    if (steps.length === 0) return;
    const sql = this.sql;
    await sql`
      insert into public.approval_rule_step ${sql(
        steps.map((s) => ({
          tenant_id: this.tenantId,
          rule_id: ruleId,
          step_order: s.stepOrder,
          kind: s.kind,
          role_id: s.roleId,
          min_amount: s.minAmount,
          max_amount: s.maxAmount,
        }))
      )}`;
  }

  async officeExists(officeId: string): Promise<boolean> {
    const [row] = await this.sql<{ id: string }[]>`
      select id from public.office where tenant_id = ${this.tenantId} and id = ${officeId}`;
    return row !== undefined;
  }

  async doaReferenceCurrency(): Promise<string> {
    const [row] = await this.sql<{ currency: string }[]>`
      select doa_reference_currency as currency from public.tenant where id = ${this.tenantId}`;
    return row?.currency ?? 'USD';
  }

  // --- ApprovalRoutingStore ------------------------------------------------------------------

  async roleHolders(roleId: string): Promise<Candidate[]> {
    const rows = await this.sql<
      {
        user_id: string;
        id: string;
        status: MembershipStatus;
        org_wide_access: boolean;
        role_ids: string[];
        office_ids: string[];
      }[]
    >`
      select m.user_id, m.id, m.status, m.org_wide_access,
             coalesce((select jsonb_agg(ur.role_id) from public.user_role ur
                       where ur.membership_id = m.id), '[]'::jsonb) as role_ids,
             coalesce((select jsonb_agg(uo.office_id) from public.user_office uo
                       where uo.membership_id = m.id), '[]'::jsonb) as office_ids
      from public.membership m
      where m.tenant_id = ${this.tenantId}
        and exists (
          select 1 from public.user_role ur
          where ur.membership_id = m.id and ur.role_id = ${roleId}
        )`;
    return rows.map((r) => ({
      userId: r.user_id,
      membershipId: r.id,
      status: r.status,
      orgWideAccess: r.org_wide_access,
      roleIds: r.role_ids,
      officeIds: r.office_ids,
    }));
  }

  async rolePermissions(roleIds: readonly string[]): Promise<Map<string, Permission[]>> {
    const sql = this.sql;
    const rows = await sql<{ role_id: string; codes: Permission[] }[]>`
      select role_id, jsonb_agg(permission_code) as codes
      from public.role_permission
      where tenant_id = ${this.tenantId} and role_id = any (${sql.array([...roleIds])}::uuid[])
      group by role_id`;
    return new Map(rows.map((r) => [r.role_id, r.codes]));
  }

  async roleNames(roleIds: readonly string[]): Promise<Map<string, RoleName>> {
    const sql = this.sql;
    const rows = await sql<{ id: string; name_ar: string; name_en: string }[]>`
      select id, name_ar, name_en from public.role
      where tenant_id = ${this.tenantId} and id = any (${sql.array([...roleIds])}::uuid[])`;
    return new Map(rows.map((r) => [r.id, { nameAr: r.name_ar, nameEn: r.name_en }]));
  }

  docSignatures(docType: DocTypeCode, docId: string): Promise<Signature[]> {
    return docSignaturesOf(this.sql, this.tenantId, docType, docId);
  }

  async prSignatures(prId: string): Promise<Signature[]> {
    const rows = await this.sql<
      { user_id: string; action: string; cycle: number; step_order: number | null }[]
    >`
      select user_id, action, cycle, step_order from public.approval_action
      where tenant_id = ${this.tenantId} and pr_id = ${prId}`;
    return rows.map((r) => ({
      userId: r.user_id,
      action: r.action,
      cycle: r.cycle,
      stepOrder: r.step_order,
    }));
  }
}

/** doc_signature rows of a non-PR document, for step eligibility (002). */
export async function docSignaturesOf(
  sql: TxSql,
  tenantId: string,
  docType: DocTypeCode,
  docId: string
): Promise<Signature[]> {
  const rows = await sql<
    { user_id: string; action: string; cycle: number; step_order: number | null }[]
  >`
    select user_id, action, cycle, step_order from public.doc_signature
    where tenant_id = ${tenantId} and doc_type = ${docType} and doc_id = ${docId}`;
  return rows.map((r) => ({
    userId: r.user_id,
    action: r.action,
    cycle: r.cycle,
    stepOrder: r.step_order,
  }));
}

/** PrStepWriter for ApprovalRoutingService.materialiseSteps (US4 submit). */
export function prStepWriter(tenantId: string): PrStepWriter {
  return async (tx, rows) => {
    if (rows.length === 0) return;
    await tx`
      insert into public.pr_approval_step ${tx(
        rows.map((r) => ({
          tenant_id: tenantId,
          pr_id: r.prId,
          cycle: r.cycle,
          step_order: r.stepOrder,
          kind: r.kind,
          required_role_id: r.requiredRoleId,
          rule_step_id: r.ruleStepId,
          status: r.status,
        }))
      )}`;
  };
}
