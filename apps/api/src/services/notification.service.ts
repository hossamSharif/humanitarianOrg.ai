// In-app notifications (research R16, 002 R29). Write side: rows inserted inside the
// transition's transaction for the eligible users of a step that became pending, or the creator
// when their document moves on — PR kinds for PRs (001), doc_* kinds for every other type.
// Read side (US8, FR-048): the recipient's list, unread count and read marks.
import type {
  DocTypeCode,
  NotificationItem,
  NotificationList,
  NotificationListQuery,
} from '@ngo/shared';
import { withTenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import {
  NotificationRepository,
  type NotificationInboxStore,
  type NotificationKind,
  type NotificationStore,
} from '../repositories/notification.repository';
import type { RequestContext } from '../types/context';
import type {
  ApprovalRoutingService,
  EligibilityPr,
  EligibilityStep,
} from './approval-routing.service';

export interface NotifiedPr extends EligibilityPr {
  id: string;
  number: string | null;
}

/** A non-PR document as notifications see it (`doc` names its type). */
export interface NotifiedDoc extends NotifiedPr {
  doc: NonNullable<EligibilityPr['doc']>;
}

export type DocOutcomeKind = 'doc_approved' | 'doc_rejected' | 'doc_returned' | 'doc_cancelled';

export class NotificationService {
  constructor(
    private readonly store: NotificationStore,
    private readonly routing: ApprovalRoutingService
  ) {}

  /** `pr_action_required` for everyone who may act on `step`; returns their user ids. */
  async notifyStepEligible(
    pr: NotifiedPr,
    step: EligibilityStep,
    actorName: string
  ): Promise<string[]> {
    const users = await this.routing.eligibleUsers(step, pr);
    const userIds = [...new Set(users.map((u) => u.userId))];
    await this.store.insertMany(
      userIds.map((userId) => ({
        userId,
        kind: 'pr_action_required',
        prId: pr.id,
        params: { number: pr.number, stepKind: step.kind, actorName },
      }))
    );
    return userIds;
  }

  /** pr_approved / pr_rejected / pr_returned / pr_cancelled to the requester. */
  async notifyRequester(
    pr: NotifiedPr & { requesterId: string },
    kind: Exclude<NotificationKind, 'pr_action_required' | 'pr_reassigned'>,
    actorName: string
  ): Promise<void> {
    await this.store.insertMany([
      {
        userId: pr.requesterId,
        kind,
        prId: pr.id,
        params: { number: pr.number, stepKind: null, actorName },
      },
    ]);
  }

  /** `pr_reassigned` to the user a step was assigned to. */
  async notifyReassigned(
    pr: NotifiedPr,
    step: Pick<EligibilityStep, 'kind'>,
    userId: string,
    actorName: string
  ): Promise<void> {
    await this.store.insertMany([
      {
        userId,
        kind: 'pr_reassigned',
        prId: pr.id,
        params: { number: pr.number, stepKind: step.kind, actorName },
      },
    ]);
  }
}

/** doc_* notifications for any non-PR document (002 data-model §9). */
export class DocNotificationService {
  constructor(
    private readonly store: NotificationStore,
    private readonly routing: ApprovalRoutingService
  ) {}

  private row(doc: NotifiedDoc, userId: string, kind: NotificationKind, params: Params) {
    const docType: DocTypeCode = doc.doc.docType;
    return { userId, kind, docType, docId: doc.id, params };
  }

  /** `doc_action_required` for everyone who may act on `step`; returns their user ids. */
  async notifyStepEligible(
    doc: NotifiedDoc,
    step: EligibilityStep,
    actorName: string
  ): Promise<string[]> {
    const users = await this.routing.eligibleUsers(step, doc);
    const userIds = [...new Set(users.map((u) => u.userId))];
    await this.store.insertMany(
      userIds.map((userId) =>
        this.row(doc, userId, 'doc_action_required', {
          number: doc.number,
          stepKind: step.kind,
          actorName,
        })
      )
    );
    return userIds;
  }

  /** doc_approved / doc_rejected / doc_returned / doc_cancelled to the creator. */
  async notifyCreator(doc: NotifiedDoc, kind: DocOutcomeKind, actorName: string): Promise<void> {
    if (!doc.requesterId) return;
    await this.store.insertMany([
      this.row(doc, doc.requesterId, kind, { number: doc.number, stepKind: null, actorName }),
    ]);
  }

  /** `doc_reassigned` to the user a step was assigned to. */
  async notifyReassigned(
    doc: NotifiedDoc,
    step: Pick<EligibilityStep, 'kind'>,
    userId: string,
    actorName: string
  ): Promise<void> {
    await this.store.insertMany([
      this.row(doc, userId, 'doc_reassigned', {
        number: doc.number,
        stepKind: step.kind,
        actorName,
      }),
    ]);
  }
}

type Params = Record<string, string | null>;

/** The caller's own notifications; every call is one tenant transaction (RLS as the caller). */
export class NotificationInbox {
  constructor(
    private readonly userId: string,
    private readonly run: <T>(fn: (store: NotificationInboxStore) => Promise<T>) => Promise<T>
  ) {}

  static forContext(ctx: RequestContext): NotificationInbox {
    return new NotificationInbox(ctx.userId, (fn) =>
      withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, (tx) =>
        fn(new NotificationRepository(tx.sql, ctx.tenantId))
      )
    );
  }

  /** GET /notifications */
  list(query: NotificationListQuery): Promise<NotificationList> {
    return this.run(async (store) => {
      const [data, unreadCount] = await Promise.all([
        store.list(this.userId, { unreadOnly: query.unread === true, limit: query.limit }),
        store.unreadCount(this.userId),
      ]);
      return { data, unreadCount };
    });
  }

  /** POST /notifications/:id/read — 404 for anyone else's notification. */
  markRead(id: string): Promise<NotificationItem> {
    return this.run(async (store) => {
      const item = await store.markRead(this.userId, id);
      if (!item) throw new AppError('NOT_FOUND', 'notification not found');
      return item;
    });
  }

  /** POST /notifications/read-all */
  markAllRead(): Promise<{ updated: number }> {
    return this.run(async (store) => ({ updated: await store.markAllRead(this.userId) }));
  }
}
