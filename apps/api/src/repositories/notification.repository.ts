// In-app notifications (research R16): inserted inside the transaction of the PR transition that
// causes them, so a rolled-back command notifies nobody. Readers see only their own rows (RLS).
import type { TxSql } from '../db/tx';

export type NotificationKind =
  | 'pr_action_required'
  | 'pr_approved'
  | 'pr_rejected'
  | 'pr_returned'
  | 'pr_cancelled'
  | 'pr_reassigned';

export interface NewNotification {
  userId: string;
  kind: NotificationKind;
  prId: string;
  /** rendered by the client through i18n: { number, stepKind, actorName } */
  params: Record<string, string | null>;
}

export interface NotificationStore {
  insertMany(rows: readonly NewNotification[]): Promise<void>;
}

export class NotificationRepository implements NotificationStore {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async insertMany(rows: readonly NewNotification[]): Promise<void> {
    if (rows.length === 0) return;
    await this.sql`
      insert into public.notification ${this.sql(
        rows.map((r) => ({
          tenant_id: this.tenantId,
          user_id: r.userId,
          kind: r.kind,
          pr_id: r.prId,
          params: this.sql.json(r.params),
        }))
      )}`;
  }
}
