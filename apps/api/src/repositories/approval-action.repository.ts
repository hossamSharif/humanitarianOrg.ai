// approval_action: signatures and every other PR action, insert-only (FR-031). The table has
// no update/delete grants and a trigger blocks both, so this repository only appends and reads.
import type { PrActionView } from '@ngo/shared';
import type { TxSql } from '../db/tx';

export type ApprovalActionKind =
  'submit' | 'approve' | 'reject' | 'return' | 'cancel' | 'reassign' | 'change_budget_line';

export interface NewApprovalAction {
  prId: string;
  stepId: string | null;
  cycle: number;
  stepOrder: number | null;
  action: ApprovalActionKind;
  /** name and position at the moment of acting (signature snapshot) */
  userName: string;
  userPosition: string | null;
  comment: string | null;
  payload: Record<string, unknown> | null;
}

export interface ApprovalActionStore {
  insert(row: NewApprovalAction): Promise<void>;
  list(prId: string): Promise<PrActionView[]>;
}

export class ApprovalActionRepository implements ApprovalActionStore {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async insert(row: NewApprovalAction): Promise<void> {
    const payload = row.payload ? this.sql.json(row.payload as Parameters<TxSql['json']>[0]) : null;
    // user_id defaults to auth.uid(): the policy only admits the caller's own actions
    await this.sql`
      insert into public.approval_action
        (tenant_id, pr_id, step_id, cycle, step_order, action, user_name, user_position,
         comment, payload)
      values (${this.tenantId}, ${row.prId}, ${row.stepId}, ${row.cycle}, ${row.stepOrder},
              ${row.action}, ${row.userName}, ${row.userPosition}, ${row.comment}, ${payload})`;
  }

  async list(prId: string): Promise<PrActionView[]> {
    const rows = await this.sql<
      {
        id: string;
        cycle: number;
        step_order: number | null;
        action: string;
        user_id: string;
        user_name: string;
        user_position: string | null;
        comment: string | null;
        acted_at: string;
      }[]
    >`
      select id, cycle, step_order, action, user_id, user_name, user_position, comment,
             to_json(acted_at)#>>'{}' as acted_at
      from public.approval_action where pr_id = ${prId}
      order by acted_at, created_at, id`;
    return rows.map((r) => ({
      id: r.id,
      cycle: r.cycle,
      stepOrder: r.step_order,
      action: r.action,
      userId: r.user_id,
      userName: r.user_name,
      userPosition: r.user_position,
      comment: r.comment,
      actedAt: r.acted_at,
    }));
  }
}
