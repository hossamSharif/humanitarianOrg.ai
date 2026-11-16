// In-app notifications (contracts/rest-api.md "Reports & notifications", FR-048, research R16).
// The client renders each item from `kind` + `params` through i18n.
import { z } from 'zod';
import type { StepKind } from '../permissions';

export const NOTIFICATION_KINDS = [
  'pr_action_required',
  'pr_approved',
  'pr_rejected',
  'pr_returned',
  'pr_cancelled',
  'pr_reassigned',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notificationListQuery = z.object({
  unread: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type NotificationListQuery = z.output<typeof notificationListQuery>;

export interface NotificationParams {
  number: string | null;
  stepKind: StepKind | null;
  actorName: string | null;
}

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  prId: string;
  params: NotificationParams;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  data: NotificationItem[];
  unreadCount: number;
}
