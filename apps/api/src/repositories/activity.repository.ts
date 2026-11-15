import type { Activity } from '@ngo/shared';
import { AppError } from '../middleware/error';
import type { RequestContext } from '../types/context';
import { TableAccess, unwrap, unwrapList } from './query-helpers';

export type ActivityValues = Omit<Activity, 'id'>;

/** Port used by ActivityService; supabase-js below, in memory for unit tests. */
export interface ActivityStore {
  listByGrant(grantId: string): Promise<Activity[]>;
  findById(id: string): Promise<Activity | null>;
  findByCode(grantId: string, code: string): Promise<Activity | null>;
  insert(values: ActivityValues): Promise<Activity>;
  update(id: string, values: Partial<ActivityValues>): Promise<Activity>;
}

const COLUMNS = 'id,grant_id,code,name,is_active';

interface ActivityRow {
  id: string;
  grant_id: string;
  code: string;
  name: string;
  is_active: boolean;
}

function toActivity(r: ActivityRow): Activity {
  return { id: r.id, grantId: r.grant_id, code: r.code, name: r.name, isActive: r.is_active };
}

function toRow(values: Partial<ActivityValues>): Record<string, unknown> {
  const row: Record<string, unknown> = {
    grant_id: values.grantId,
    code: values.code,
    name: values.name,
    is_active: values.isActive,
  };
  for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
  return row;
}

export class ActivityRepository implements ActivityStore {
  private readonly t: TableAccess;

  constructor(private readonly ctx: RequestContext) {
    this.t = new TableAccess(ctx, 'activity');
  }

  async listByGrant(grantId: string): Promise<Activity[]> {
    const rows = unwrapList<ActivityRow>(
      await this.t.from().select(COLUMNS).eq('grant_id', grantId).order('code')
    );
    return rows.map(toActivity);
  }

  async findById(id: string): Promise<Activity | null> {
    const row = unwrap<ActivityRow>(await this.t.from().select(COLUMNS).eq('id', id).maybeSingle());
    return row ? toActivity(row) : null;
  }

  async findByCode(grantId: string, code: string): Promise<Activity | null> {
    const row = unwrap<ActivityRow>(
      await this.t.from().select(COLUMNS).eq('grant_id', grantId).eq('code', code).maybeSingle()
    );
    return row ? toActivity(row) : null;
  }

  async insert(values: ActivityValues): Promise<Activity> {
    const row = unwrap<ActivityRow>(
      await this.t
        .from()
        .insert({ ...toRow(values), tenant_id: this.ctx.tenantId })
        .select(COLUMNS)
        .single()
    );
    return toActivity(row!);
  }

  async update(id: string, values: Partial<ActivityValues>): Promise<Activity> {
    const row = unwrap<ActivityRow>(
      await this.t.from().update(toRow(values)).eq('id', id).select(COLUMNS).maybeSingle()
    );
    if (!row) throw new AppError('NOT_FOUND', 'activity not found');
    return toActivity(row);
  }
}
