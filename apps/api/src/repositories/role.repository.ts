// Roles and their permission sets (data-model §1, FR-017), plus the read-only permission
// catalogue. Runs inside withTenantTx so a role and its role_permission rows change together.
import type { ListResponse, Pagination, Permission, PermissionInfo, Role } from '@ngo/shared';
import type postgres from 'postgres';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

type Fragment = postgres.PendingQuery<postgres.Row[]>;
export interface RoleValues {
  nameAr: string;
  nameEn: string;
}

/** What still points at a role; any non-zero count blocks deleting it. */
export interface RoleUsage {
  memberCount: number;
  ruleStepCount: number;
  prStepCount: number;
}

interface RoleRow {
  id: string;
  key: string | null;
  name_ar: string;
  name_en: string;
  is_system: boolean;
  permissions: Permission[];
  member_count: number;
  rule_step_count: number;
  total?: number;
}

function toRole(r: RoleRow): Role {
  return {
    id: r.id,
    key: r.key,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    isSystem: r.is_system,
    permissions: r.permissions,
    memberCount: r.member_count,
    ruleStepCount: r.rule_step_count,
  };
}

export class RoleRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  private select(where: Fragment, tail: Fragment) {
    return this.sql<RoleRow[]>`
      select r.id, r.key, r.name_ar, r.name_en, r.is_system,
             coalesce((
               select jsonb_agg(rp.permission_code order by rp.permission_code)
               from public.role_permission rp where rp.role_id = r.id
             ), '[]'::jsonb) as permissions,
             (select count(*)::int from public.user_role ur where ur.role_id = r.id)
               as member_count,
             (select count(*)::int from public.approval_rule_step s where s.role_id = r.id)
               as rule_step_count,
             count(*) over ()::int as total
      from public.role r
      where r.tenant_id = ${this.tenantId} ${where}
      ${tail}`;
  }

  async list(pagination: Pagination): Promise<ListResponse<Role>> {
    const { page, pageSize } = pagination;
    const rows = await this.select(
      this.sql``,
      this.sql`order by r.is_system desc, r.name_en, r.id
               limit ${pageSize} offset ${(page - 1) * pageSize}`
    );
    return { data: rows.map(toRole), page, pageSize, total: rows[0]?.total ?? 0 };
  }

  async findById(id: string): Promise<Role | null> {
    const [row] = await this.select(this.sql`and r.id = ${id}`, this.sql``);
    return row ? toRole(row) : null;
  }

  async getById(id: string): Promise<Role> {
    const role = await this.findById(id);
    if (!role) throw new AppError('NOT_FOUND', 'Role not found');
    return role;
  }

  async insert(values: RoleValues): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.role (tenant_id, name_ar, name_en)
      values (${this.tenantId}, ${values.nameAr}, ${values.nameEn})
      returning id`;
    return row!.id;
  }

  async update(id: string, values: Partial<RoleValues>): Promise<void> {
    const sql = this.sql;
    const columns: Record<string, unknown> = { name_ar: values.nameAr, name_en: values.nameEn };
    for (const key of Object.keys(columns)) if (columns[key] === undefined) delete columns[key];
    if (Object.keys(columns).length === 0) return;
    const rows = await sql`
      update public.role set ${sql(columns)}
      where tenant_id = ${this.tenantId} and id = ${id}
      returning id`;
    if (rows.length === 0) throw new AppError('NOT_FOUND', 'Role not found');
  }

  async delete(id: string): Promise<void> {
    const rows = await this.sql`
      delete from public.role where tenant_id = ${this.tenantId} and id = ${id} returning id`;
    if (rows.length === 0) throw new AppError('NOT_FOUND', 'Role not found');
  }

  /** Makes the role's permissions exactly `codes`. */
  async setPermissions(roleId: string, codes: readonly Permission[]): Promise<void> {
    const sql = this.sql;
    await sql`
      delete from public.role_permission
      where tenant_id = ${this.tenantId} and role_id = ${roleId}
        and not (permission_code = any (${sql.array([...codes])}::text[]))`;
    if (codes.length === 0) return;
    await sql`
      insert into public.role_permission ${sql(
        codes.map((code) => ({ role_id: roleId, permission_code: code, tenant_id: this.tenantId }))
      )}
      on conflict (role_id, permission_code) do nothing`;
  }

  async usage(roleId: string): Promise<RoleUsage> {
    const [row] = await this.sql<
      { member_count: number; rule_step_count: number; pr_step_count: number }[]
    >`
      select
        (select count(*)::int from public.user_role where role_id = ${roleId}) as member_count,
        (select count(*)::int from public.approval_rule_step where role_id = ${roleId})
          as rule_step_count,
        (select count(*)::int from public.pr_approval_step where required_role_id = ${roleId})
          as pr_step_count`;
    return {
      memberCount: row?.member_count ?? 0,
      ruleStepCount: row?.rule_step_count ?? 0,
      prStepCount: row?.pr_step_count ?? 0,
    };
  }

  /** The ids among `roleIds` that are roles of this tenant. */
  async existingIds(roleIds: readonly string[]): Promise<Set<string>> {
    if (roleIds.length === 0) return new Set();
    const sql = this.sql;
    const rows = await sql<{ id: string }[]>`
      select id from public.role
      where tenant_id = ${this.tenantId} and id = any (${sql.array([...roleIds])}::uuid[])`;
    return new Set(rows.map((r) => r.id));
  }

  async listPermissions(): Promise<PermissionInfo[]> {
    const rows = await this.sql<
      { code: Permission; description_ar: string; description_en: string }[]
    >`
      select code, description_ar, description_en from public.permission order by code`;
    return rows.map((r) => ({
      code: r.code,
      descriptionAr: r.description_ar,
      descriptionEn: r.description_en,
    }));
  }
}
