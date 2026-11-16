// In-app notifications written inside the PR transition's transaction (research R16): the
// eligible users of a step that became pending, or the requester when their PR moves on.
import type { NotificationKind, NotificationStore } from '../repositories/notification.repository';
import type {
  ApprovalRoutingService,
  EligibilityPr,
  EligibilityStep,
} from './approval-routing.service';

export interface NotifiedPr extends EligibilityPr {
  id: string;
  number: string | null;
}

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
