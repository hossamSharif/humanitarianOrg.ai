// Reads behind the PR timeline (FR-044): the PR's audit_history rows (header, lines,
// attachments), its approval_action rows with the step kind, and the labels needed to show who
// acted and what an id referred to. audit_history is readable for PRs the caller can read (RLS).
import type { PrStatus, StepKind } from '@ngo/shared';
import type { TxSql } from '../db/tx';

export interface AuditRow {
  id: string;
  tableName: 'purchase_requisition' | 'pr_line' | 'pr_attachment';
  action: 'insert' | 'update' | 'delete';
  actorId: string | null;
  /** ISO instant; equal to the acted_at of an approval_action written in the same transaction */
  occurredAt: string;
  fromState: PrStatus | null;
  toState: PrStatus | null;
  changedFields: string[];
  /** column → value as text (jsonb_each_text), exact for numerics and dates */
  oldData: Record<string, string | null> | null;
  newData: Record<string, string | null> | null;
}

export interface ActionRow {
  id: string;
  action: string;
  userId: string;
  userName: string;
  userPosition: string | null;
  comment: string | null;
  payload: Record<string, unknown> | null;
  cycle: number;
  stepKind: StepKind | null;
  actedAt: string;
}

export interface ActorLabel {
  nameAr: string;
  nameEn: string;
  position: string | null;
}

export interface PrHistoryStore {
  /** false when the PR does not exist or is outside the caller's offices (RLS) */
  prExists(prId: string): Promise<boolean>;
  auditRows(prId: string): Promise<AuditRow[]>;
  actions(prId: string): Promise<ActionRow[]>;
  actors(userIds: readonly string[]): Promise<Map<string, ActorLabel>>;
  /** id → code for offices, grants, budget lines, units and activities */
  codes(ids: readonly string[]): Promise<Map<string, string>>;
  /** pr_line id → line number */
  lineNumbers(prId: string): Promise<Map<string, number>>;
}

export class PrHistoryRepository implements PrHistoryStore {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async prExists(prId: string): Promise<boolean> {
    const rows = await this.sql`select 1 from public.purchase_requisition where id = ${prId}`;
    return rows.length > 0;
  }

  async auditRows(prId: string): Promise<AuditRow[]> {
    return this.sql<AuditRow[]>`
      select h.id::text as "id", h.table_name as "tableName", h.action as "action",
             h.actor_id as "actorId", to_json(h.occurred_at)#>>'{}' as "occurredAt",
             h.from_state as "fromState", h.to_state as "toState",
             coalesce(h.changed_fields, '{}') as "changedFields",
             (select jsonb_object_agg(e.key, e.value) from jsonb_each_text(h.old_data) e)
               as "oldData",
             (select jsonb_object_agg(e.key, e.value) from jsonb_each_text(h.new_data) e)
               as "newData"
      from public.audit_history h
      where h.tenant_id = ${this.tenantId} and h.pr_id = ${prId}
        and h.table_name in ('purchase_requisition', 'pr_line', 'pr_attachment')
      order by h.occurred_at, h.id`;
  }

  async actions(prId: string): Promise<ActionRow[]> {
    return this.sql<ActionRow[]>`
      select a.id, a.action, a.user_id as "userId", a.user_name as "userName",
             a.user_position as "userPosition", a.comment, a.payload, a.cycle,
             s.kind as "stepKind", to_json(a.acted_at)#>>'{}' as "actedAt"
      from public.approval_action a
      left join public.pr_approval_step s on s.id = a.step_id
      where a.tenant_id = ${this.tenantId} and a.pr_id = ${prId}
      order by a.acted_at, a.created_at`;
  }

  async actors(userIds: readonly string[]): Promise<Map<string, ActorLabel>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.sql<
      {
        user_id: string;
        full_name_ar: string;
        full_name_en: string;
        position_title: string | null;
      }[]
    >`
      select user_id, full_name_ar, full_name_en, position_title from public.membership
      where tenant_id = ${this.tenantId} and user_id in ${this.sql([...new Set(userIds)])}`;
    return new Map(
      rows.map((r) => [
        r.user_id,
        { nameAr: r.full_name_ar, nameEn: r.full_name_en, position: r.position_title },
      ])
    );
  }

  async codes(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const list = this.sql.array([...new Set(ids)]);
    const rows = await this.sql<{ id: string; code: string }[]>`
      select id, code from public.office where id = any (${list}::uuid[])
      union all select id, code from public."grant" where id = any (${list}::uuid[])
      union all select id, code from public.budget_line where id = any (${list}::uuid[])
      union all select id, code from public.unit_of_measure where id = any (${list}::uuid[])
      union all select id, code from public.activity where id = any (${list}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.code]));
  }

  async lineNumbers(prId: string): Promise<Map<string, number>> {
    const rows = await this.sql<{ id: string; line_no: number }[]>`
      select id, line_no from public.pr_line where pr_id = ${prId}`;
    return new Map(rows.map((r) => [r.id, r.line_no]));
  }
}
