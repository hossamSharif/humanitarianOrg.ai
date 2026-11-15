// Optional activities per grant (FR-011); codes are unique within a grant.
import type { Activity, ActivityCreate, ActivityUpdate, Grant } from '@ngo/shared';
import { AppError } from '../middleware/error';
import { ActivityRepository, type ActivityStore } from '../repositories/activity.repository';
import { GrantRepository } from '../repositories/grant.repository';
import type { RequestContext } from '../types/context';

export interface ActivityDeps {
  grants: { findById(id: string): Promise<Grant | null> };
  activities: ActivityStore;
}

export class ActivityService {
  constructor(private readonly deps: ActivityDeps) {}

  static forContext(ctx: RequestContext): ActivityService {
    return new ActivityService({
      grants: new GrantRepository(ctx),
      activities: new ActivityRepository(ctx),
    });
  }

  async list(grantId: string): Promise<Activity[]> {
    await this.assertGrant(grantId);
    return this.deps.activities.listByGrant(grantId);
  }

  async create(grantId: string, input: ActivityCreate): Promise<Activity> {
    await this.assertGrant(grantId);
    await this.assertCodeFree(grantId, input.code);
    return this.deps.activities.insert({
      grantId,
      code: input.code,
      name: input.name,
      isActive: input.isActive ?? true,
    });
  }

  async update(id: string, input: ActivityUpdate): Promise<Activity> {
    const current = await this.deps.activities.findById(id);
    if (!current) throw new AppError('NOT_FOUND', 'activity not found');
    if (input.code !== undefined && input.code !== current.code) {
      await this.assertCodeFree(current.grantId, input.code, id);
    }
    return this.deps.activities.update(id, input);
  }

  private async assertGrant(grantId: string): Promise<void> {
    if (!(await this.deps.grants.findById(grantId))) {
      throw new AppError('NOT_FOUND', 'grant not found');
    }
  }

  private async assertCodeFree(grantId: string, code: string, exceptId?: string) {
    const existing = await this.deps.activities.findByCode(grantId, code);
    if (existing && existing.id !== exceptId) {
      throw new AppError('VALIDATION_ERROR', 'An activity with this code already exists', [
        { field: 'code', message: 'already_exists' },
      ]);
    }
  }
}
