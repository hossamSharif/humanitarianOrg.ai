// Roles as editable permission sets (FR-017). Seeded roles are editable too; no role can be
// deleted while a member holds it, an approval rule step requires it, or a PR route used it.
import type {
  ListResponse,
  Pagination,
  PermissionInfo,
  Role,
  RoleCreate,
  RoleUpdate,
} from '@ngo/shared';
import { withTenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import { RoleRepository, type RoleUsage } from '../repositories/role.repository';
import type { RequestContext } from '../types/context';

export interface RoleServiceDeps {
  run<T>(ctx: RequestContext, fn: (roles: RoleRepository) => Promise<T>): Promise<T>;
}

export const defaultRoleDeps: RoleServiceDeps = {
  run: (ctx, fn) =>
    withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, ({ sql }) =>
      fn(new RoleRepository(sql, ctx.tenantId))
    ),
};

function inUse(usage: RoleUsage): boolean {
  return usage.memberCount > 0 || usage.ruleStepCount > 0 || usage.prStepCount > 0;
}

function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23503';
}

export class RoleService {
  constructor(private readonly deps: RoleServiceDeps = defaultRoleDeps) {}

  listPermissions(ctx: RequestContext): Promise<PermissionInfo[]> {
    return this.deps.run(ctx, (roles) => roles.listPermissions());
  }

  list(ctx: RequestContext, pagination: Pagination): Promise<ListResponse<Role>> {
    return this.deps.run(ctx, (roles) => roles.list(pagination));
  }

  get(ctx: RequestContext, id: string): Promise<Role> {
    return this.deps.run(ctx, (roles) => roles.getById(id));
  }

  create(ctx: RequestContext, body: RoleCreate): Promise<Role> {
    return this.deps.run(ctx, async (roles) => {
      const id = await roles.insert({ nameAr: body.nameAr, nameEn: body.nameEn });
      await roles.setPermissions(id, body.permissions);
      return roles.getById(id);
    });
  }

  update(ctx: RequestContext, id: string, body: RoleUpdate): Promise<Role> {
    return this.deps.run(ctx, async (roles) => {
      await roles.getById(id);
      await roles.update(id, { nameAr: body.nameAr, nameEn: body.nameEn });
      if (body.permissions) await roles.setPermissions(id, body.permissions);
      return roles.getById(id);
    });
  }

  delete(ctx: RequestContext, id: string): Promise<void> {
    return this.deps.run(ctx, async (roles) => {
      await roles.getById(id);
      const usage = await roles.usage(id);
      if (inUse(usage)) {
        throw new AppError(
          'ROLE_IN_USE',
          'The role is assigned or used by an approval rule',
          usage
        );
      }
      try {
        await roles.delete(id);
      } catch (err) {
        // a reference this caller cannot see (e.g. a PR step outside their offices)
        if (isForeignKeyViolation(err)) {
          throw new AppError('ROLE_IN_USE', 'The role is still referenced', usage);
        }
        throw err;
      }
    });
  }
}
