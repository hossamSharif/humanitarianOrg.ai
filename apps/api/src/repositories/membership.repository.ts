// Memberships with their offices and roles (data-model §1). Runs inside withTenantTx so the
// membership row and its user_office / user_role sets change in one transaction; RLS applies
// (role authenticated + the caller's claims), and every query also filters on tenant_id.
import type { ListResponse, MembershipStatus, Pagination, Sort, User } from '@ngo/shared';
import type postgres from 'postgres';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

type Fragment = postgres.PendingQuery<postgres.Row[]>;
export interface MembershipFilter {
  status?: MembershipStatus;
  /** matches email and both names */
  q?: string;
}

export interface MembershipValues {
  userId: string;
  email: string;
  fullNameAr: string;
  fullNameEn: string;
  positionTitle: string | null;
  orgWideAccess: boolean;
}

export interface MembershipChanges {
  fullNameAr?: string;
  fullNameEn?: string;
  positionTitle?: string | null;
  orgWideAccess?: boolean;
  status?: MembershipStatus;
}

const SORTABLE: Record<string, string> = {
  fullNameEn: 'full_name_en',
  fullNameAr: 'full_name_ar',
  email: 'email',
  status: 'status',
  invitedAt: 'invited_at',
};

interface UserRow {
  id: string;
  user_id: string;
  email: string;
  full_name_ar: string;
  full_name_en: string;
  position_title: string | null;
  org_wide_access: boolean;
  status: MembershipStatus;
  invited_at: Date | null;
  activated_at: Date | null;
  roles: User['roles'];
  offices: User['offices'];
  permissions: User['permissions'];
  total?: number;
}

function toUser(r: UserRow): User {
  return {
    membershipId: r.id,
    userId: r.user_id,
    email: r.email,
    fullNameAr: r.full_name_ar,
    fullNameEn: r.full_name_en,
    positionTitle: r.position_title,
    orgWideAccess: r.org_wide_access,
    status: r.status,
    invitedAt: r.invited_at ? r.invited_at.toISOString() : null,
    activatedAt: r.activated_at ? r.activated_at.toISOString() : null,
    roles: r.roles,
    offices: r.offices,
    permissions: r.permissions,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export class MembershipRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  private select(where: Fragment, tail: Fragment) {
    const sql = this.sql;
    return sql<UserRow[]>`
      select m.id, m.user_id, m.email::text as email, m.full_name_ar, m.full_name_en,
             m.position_title, m.org_wide_access, m.status, m.invited_at, m.activated_at,
             coalesce((
               select jsonb_agg(
                 jsonb_build_object('id', r.id, 'nameAr', r.name_ar, 'nameEn', r.name_en)
                 order by r.name_en)
               from public.user_role ur join public.role r on r.id = ur.role_id
               where ur.membership_id = m.id
             ), '[]'::jsonb) as roles,
             coalesce((
               select jsonb_agg(
                 jsonb_build_object(
                   'id', o.id, 'code', o.code, 'nameAr', o.name_ar, 'nameEn', o.name_en)
                 order by o.code)
               from public.user_office uo join public.office o on o.id = uo.office_id
               where uo.membership_id = m.id
             ), '[]'::jsonb) as offices,
             coalesce((
               select jsonb_agg(distinct rp.permission_code)
               from public.user_role ur
               join public.role_permission rp on rp.role_id = ur.role_id
               where ur.membership_id = m.id
             ), '[]'::jsonb) as permissions,
             count(*) over ()::int as total
      from public.membership m
      where m.tenant_id = ${this.tenantId} ${where}
      ${tail}`;
  }

  async list(
    filter: MembershipFilter,
    pagination: Pagination,
    sort: Sort = { field: 'fullNameEn', direction: 'asc' }
  ): Promise<ListResponse<User>> {
    const sql = this.sql;
    const column = SORTABLE[sort.field];
    if (!column) {
      throw new AppError('VALIDATION_ERROR', `Cannot sort by ${sort.field}`, [
        { field: 'query.sort', message: 'unsupported_field' },
      ]);
    }
    const like = filter.q ? `%${escapeLike(filter.q)}%` : null;
    const where = sql`
      ${filter.status ? sql`and m.status = ${filter.status}` : sql``}
      ${
        like
          ? sql`and (m.email::text ilike ${like} or m.full_name_ar ilike ${like}
                     or m.full_name_en ilike ${like})`
          : sql``
      }`;
    const { page, pageSize } = pagination;
    const rows = await this.select(
      where,
      sql`order by ${sql(column)} ${sort.direction === 'asc' ? sql`asc` : sql`desc`}, m.id
          limit ${pageSize} offset ${(page - 1) * pageSize}`
    );
    return { data: rows.map(toUser), page, pageSize, total: rows[0]?.total ?? 0 };
  }

  async findById(membershipId: string): Promise<User | null> {
    const [row] = await this.select(this.sql`and m.id = ${membershipId}`, this.sql``);
    return row ? toUser(row) : null;
  }

  async getById(membershipId: string): Promise<User> {
    const user = await this.findById(membershipId);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    return user;
  }

  async findIdByEmail(email: string): Promise<string | null> {
    const [row] = await this.sql<{ id: string }[]>`
      select id from public.membership
      where tenant_id = ${this.tenantId} and email = ${email}::extensions.citext`;
    return row?.id ?? null;
  }

  /** New membership in status `invited`. */
  async insert(values: MembershipValues): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.membership
        (tenant_id, user_id, email, full_name_ar, full_name_en, position_title,
         org_wide_access, status, invited_at)
      values (${this.tenantId}, ${values.userId}, ${values.email}, ${values.fullNameAr},
              ${values.fullNameEn}, ${values.positionTitle}, ${values.orgWideAccess},
              'invited', now())
      returning id`;
    return row!.id;
  }

  async update(membershipId: string, changes: MembershipChanges): Promise<void> {
    const sql = this.sql;
    const columns: Record<string, unknown> = {
      full_name_ar: changes.fullNameAr,
      full_name_en: changes.fullNameEn,
      position_title: changes.positionTitle,
      org_wide_access: changes.orgWideAccess,
      status: changes.status,
    };
    for (const key of Object.keys(columns)) if (columns[key] === undefined) delete columns[key];
    if (Object.keys(columns).length === 0) return;

    const rows = await sql`
      update public.membership set ${sql(columns)}
      where tenant_id = ${this.tenantId} and id = ${membershipId}
      returning id`;
    if (rows.length === 0) throw new AppError('NOT_FOUND', 'User not found');
  }

  /** Makes the membership's offices exactly `officeIds`. */
  async syncOffices(membershipId: string, officeIds: readonly string[]): Promise<void> {
    const sql = this.sql;
    await sql`
      delete from public.user_office
      where tenant_id = ${this.tenantId} and membership_id = ${membershipId}
        and not (office_id = any (${sql.array([...officeIds])}::uuid[]))`;
    if (officeIds.length === 0) return;
    await sql`
      insert into public.user_office ${sql(
        officeIds.map((officeId) => ({
          tenant_id: this.tenantId,
          membership_id: membershipId,
          office_id: officeId,
        }))
      )}
      on conflict (tenant_id, membership_id, office_id) do nothing`;
  }

  /** Makes the membership's roles exactly `roleIds`. */
  async syncRoles(membershipId: string, roleIds: readonly string[]): Promise<void> {
    const sql = this.sql;
    await sql`
      delete from public.user_role
      where tenant_id = ${this.tenantId} and membership_id = ${membershipId}
        and not (role_id = any (${sql.array([...roleIds])}::uuid[]))`;
    if (roleIds.length === 0) return;
    await sql`
      insert into public.user_role ${sql(
        roleIds.map((roleId) => ({
          tenant_id: this.tenantId,
          membership_id: membershipId,
          role_id: roleId,
        }))
      )}
      on conflict (tenant_id, membership_id, role_id) do nothing`;
  }

  /** The ids among `officeIds` that are offices of this tenant. */
  async existingOfficeIds(officeIds: readonly string[]): Promise<Set<string>> {
    if (officeIds.length === 0) return new Set();
    const sql = this.sql;
    const rows = await sql<{ id: string }[]>`
      select id from public.office
      where tenant_id = ${this.tenantId} and id = any (${sql.array([...officeIds])}::uuid[])`;
    return new Set(rows.map((r) => r.id));
  }
}
