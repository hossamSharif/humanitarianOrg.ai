// doc_approval_step: the route materialised for each submission cycle of any document
// (002 data-model §1). PR steps are read through the 001 view by PrApprovalStepRepository; this
// repository serves every other type, scoped to one doc type.
import type { DocStepKind, DocStepStatus, DocTypeCode } from '@ngo/shared';
import type { TxSql } from '../db/tx';

export interface DocStepRecord {
  id: string;
  cycle: number;
  stepOrder: number;
  kind: DocStepKind;
  requiredRoleId: string;
  roleNameAr: string;
  roleNameEn: string;
  assignedUserId: string | null;
  status: DocStepStatus;
  actedAt: string | null;
}

export interface DocStepChanges {
  status?: DocStepStatus;
  actedAt?: string;
  assignedUserId?: string;
}

export interface NewDocStep {
  cycle: number;
  stepOrder: number;
  kind: DocStepKind;
  requiredRoleId: string;
  ruleStepId: string;
  status: 'pending' | 'waiting';
}

export interface DocApprovalStepStore {
  list(docId: string, cycle: number): Promise<DocStepRecord[]>;
  update(id: string, changes: DocStepChanges): Promise<void>;
  /** `waiting` steps of the cycle → `cancelled` (the document left the route early). */
  cancelWaiting(docId: string, cycle: number): Promise<void>;
  insertMany(docId: string, rows: readonly NewDocStep[]): Promise<void>;
}

const STEP_COLUMN: Record<keyof DocStepChanges, string> = {
  status: 'status',
  actedAt: 'acted_at',
  assignedUserId: 'assigned_user_id',
};

export class DocApprovalStepRepository implements DocApprovalStepStore {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string,
    private readonly docType: DocTypeCode
  ) {}

  async list(docId: string, cycle: number): Promise<DocStepRecord[]> {
    const rows = await this.sql<
      {
        id: string;
        cycle: number;
        step_order: number;
        kind: DocStepKind;
        required_role_id: string;
        name_ar: string | null;
        name_en: string | null;
        assigned_user_id: string | null;
        status: DocStepStatus;
        acted_at: string | null;
      }[]
    >`
      select s.id, s.cycle, s.step_order, s.kind, s.required_role_id, r.name_ar, r.name_en,
             s.assigned_user_id, s.status, to_json(s.acted_at)#>>'{}' as acted_at
      from public.doc_approval_step s
      left join public.role r on r.id = s.required_role_id
      where s.tenant_id = ${this.tenantId} and s.doc_type = ${this.docType}
        and s.doc_id = ${docId} and s.cycle = ${cycle}
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

  async update(id: string, changes: DocStepChanges): Promise<void> {
    const columns: Record<string, string> = {};
    for (const [key, value] of Object.entries(changes) as [keyof DocStepChanges, string][]) {
      if (value !== undefined) columns[STEP_COLUMN[key]] = value;
    }
    if (Object.keys(columns).length === 0) return;
    await this.sql`
      update public.doc_approval_step set ${this.sql(columns)}
      where tenant_id = ${this.tenantId} and id = ${id}`;
  }

  async cancelWaiting(docId: string, cycle: number): Promise<void> {
    await this.sql`
      update public.doc_approval_step set status = 'cancelled'
      where tenant_id = ${this.tenantId} and doc_type = ${this.docType} and doc_id = ${docId}
        and cycle = ${cycle} and status = 'waiting'`;
  }

  async insertMany(docId: string, rows: readonly NewDocStep[]): Promise<void> {
    if (rows.length === 0) return;
    await this.sql`
      insert into public.doc_approval_step ${this.sql(
        rows.map((r) => ({
          tenant_id: this.tenantId,
          doc_type: this.docType,
          doc_id: docId,
          cycle: r.cycle,
          step_order: r.stepOrder,
          kind: r.kind,
          required_role_id: r.requiredRoleId,
          rule_step_id: r.ruleStepId,
          status: r.status,
        }))
      )}`;
  }
}
