// In-app notifications (contracts/rest-api.md "Reports & notifications", FR-048, research R16).
// The client renders each item from `kind` + `params` through i18n.
import { z } from 'zod';
import type { DocStepKind, DocTypeCode } from '../doc-types';

export const NOTIFICATION_KINDS = [
  'pr_action_required',
  'pr_approved',
  'pr_rejected',
  'pr_returned',
  'pr_cancelled',
  'pr_reassigned',
  // 002 (data-model §9): any document; scheduled kinds carry a dedupe key (R29)
  'doc_action_required',
  'doc_approved',
  'doc_rejected',
  'doc_returned',
  'doc_cancelled',
  'doc_reassigned',
  'sourcing_deadline_reached',
  'guarantee_expiring',
  'supplier_document_expiring',
  'vetting_due',
  'advance_overdue',
  'retention_release_due',
  'supplier_rating_due',
  'declaration_required',
  'signature_required',
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
  stepKind: DocStepKind | null;
  actorName: string | null;
}

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  /** the PR of a 001 notification; null for other documents */
  prId: string | null;
  docType: DocTypeCode | null;
  docId: string | null;
  params: NotificationParams;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  data: NotificationItem[];
  unreadCount: number;
}
