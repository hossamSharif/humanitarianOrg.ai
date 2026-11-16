// pr_approval_step: the route materialised for each submission cycle (data-model §4). Rows are
// written by ApprovalRoutingService.materialiseSteps (prStepWriter); this reads them back.
import type { PrStepStatus, StepKind } from '@ngo/shared';
import type { TxSql } from '../db/tx';

export interface PrStepRecord {
  id: string;
  cycle: number;
  stepOrder: number;
  kind: StepKind;
  requiredRoleId: string;
  roleNameAr: string;
  roleNameEn: string;
  assignedUserId: string | null;
  status: PrStepStatus;
  actedAt: string | null;
}

export interface PrApprovalStepStore {
  list(prId: string, cycle: number): Promise<PrStepRecord[]>;
}

export class PrApprovalStepRepository implements PrApprovalStepStore {
  constructor(private readonly sql: TxSql) {}

  async list(prId: string, cycle: number): Promise<PrStepRecord[]> {
    const rows = await this.sql<
      {
        id: string;
        cycle: number;
        step_order: number;
        kind: StepKind;
        required_role_id: string;
        name_ar: string | null;
        name_en: string | null;
        assigned_user_id: string | null;
        status: PrStepStatus;
        acted_at: string | null;
      }[]
    >`
      select s.id, s.cycle, s.step_order, s.kind, s.required_role_id, r.name_ar, r.name_en,
             s.assigned_user_id, s.status, to_json(s.acted_at)#>>'{}' as acted_at
      from public.pr_approval_step s
      left join public.role r on r.id = s.required_role_id
      where s.pr_id = ${prId} and s.cycle = ${cycle}
      order by s.step_order`;
    return rows.map((r) => ({
      id: r.id,
      cycle: r.cycle,
      stepOrder: r.step_order,
      kind: r.kind,
      requiredRoleId: r.required_role_id,
      roleNameAr: r.name_ar ?? '',
      roleNameEn: r.name_en ?? '',
      assignedUserId: r.assigned_user_id,
      status: r.status,
      actedAt: r.acted_at,
    }));
  }
}
