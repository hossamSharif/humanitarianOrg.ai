// In-app notifications (research R16): inserted inside the transaction of the PR transition that
// causes them, so a rolled-back command notifies nobody. Readers see only their own rows (RLS).
import type { NotificationItem, NotificationKind } from '@ngo/shared';
import type { TxSql } from '../db/tx';

export type { NotificationKind };

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

/** The recipient's side (US8): list, unread count, mark read. */
export interface NotificationInboxStore {
  list(
    userId: string,
    options: { unreadOnly: boolean; limit: number }
  ): Promise<NotificationItem[]>;
  unreadCount(userId: string): Promise<number>;
  /** null when the notification is not the user's (or does not exist) */
  markRead(userId: string, id: string): Promise<NotificationItem | null>;
  markAllRead(userId: string): Promise<number>;
}

const ITEM_COLUMNS = `
  id, kind, pr_id as "prId", params, to_json(read_at)#>>'{}' as "readAt",
  to_json(created_at)#>>'{}' as "createdAt"`;

export class NotificationRepository implements NotificationStore, NotificationInboxStore {
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

  // Reads filter on user_id as well as RLS (recipient-only policy), so a misconfigured policy
  // still never leaks another user's notifications.

  async list(userId: string, options: { unreadOnly: boolean; limit: number }) {
    const unread = options.unreadOnly ? this.sql`and read_at is null` : this.sql``;
    return this.sql<NotificationItem[]>`
      select ${this.sql.unsafe(ITEM_COLUMNS)} from public.notification
      where tenant_id = ${this.tenantId} and user_id = ${userId} ${unread}
      order by created_at desc, id
      limit ${options.limit}`;
  }

  async unreadCount(userId: string): Promise<number> {
    const [row] = await this.sql<{ n: number }[]>`
      select count(*)::int as n from public.notification
      where tenant_id = ${this.tenantId} and user_id = ${userId} and read_at is null`;
    return row?.n ?? 0;
  }

  async markRead(userId: string, id: string): Promise<NotificationItem | null> {
    const [row] = await this.sql<NotificationItem[]>`
      update public.notification set read_at = coalesce(read_at, now())
      where tenant_id = ${this.tenantId} and user_id = ${userId} and id = ${id}
      returning ${this.sql.unsafe(ITEM_COLUMNS)}`;
    return row ?? null;
  }

  async markAllRead(userId: string): Promise<number> {
    const rows = await this.sql`
      update public.notification set read_at = now()
      where tenant_id = ${this.tenantId} and user_id = ${userId} and read_at is null
      returning id`;
    return rows.length;
  }
}
