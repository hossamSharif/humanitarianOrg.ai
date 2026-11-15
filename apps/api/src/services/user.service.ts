// Users = memberships of the current tenant (FR-016, FR-018). Invitations go through the Supabase
// Auth admin API (the only use of the service role, Principle IV); everything else is written
// with the caller's claims under RLS. Signatures keep the name and position they had when signed
// (approval_action snapshots), so editing a user never rewrites history.
import type {
  ListResponse,
  MembershipStatus,
  Pagination,
  Sort,
  User,
  UserInvite,
  UserListQuery,
  UserUpdate,
} from '@ngo/shared';
import { getEnv } from '../config/env';
import { adminAuth } from '../db/supabase';
import { withTenantTx, type TxSql } from '../db/tx';
import { AppError } from '../middleware/error';
import { MembershipRepository } from '../repositories/membership.repository';
import { RoleRepository } from '../repositories/role.repository';
import type { RequestContext } from '../types/context';

export interface UserRepos {
  users: MembershipRepository;
  roles: RoleRepository;
}

export interface UserServiceDeps {
  run<T>(ctx: RequestContext, fn: (repos: UserRepos) => Promise<T>): Promise<T>;
  /** Sends the invitation email (new users) and returns the Auth user id. */
  inviteAuthUser(email: string, redirectTo: string | undefined): Promise<string>;
  /** Web origin the invitation links to, e.g. https://app.example.org */
  webOrigin(): string | undefined;
}

export function reposFor(sql: TxSql, ctx: RequestContext): UserRepos {
  return {
    users: new MembershipRepository(sql, ctx.tenantId),
    roles: new RoleRepository(sql, ctx.tenantId),
  };
}

export const defaultUserDeps: UserServiceDeps = {
  run: (ctx, fn) =>
    withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, ({ sql }) =>
      fn(reposFor(sql, ctx))
    ),

  async inviteAuthUser(email, redirectTo) {
    const auth = adminAuth();
    const invited = await auth.inviteUserByEmail(email, redirectTo ? { redirectTo } : undefined);
    if (invited.data.user) return invited.data.user.id;

    // Already registered (e.g. a member of another organization): no new account or email; the
    // membership activates on their next sign-in (GET /me).
    const existing = await auth.generateLink({ type: 'magiclink', email });
    if (existing.data.user) return existing.data.user.id;

    throw new AppError(
      'INTERNAL_ERROR',
      `Could not invite user: ${invited.error?.message ?? existing.error?.message ?? 'unknown'}`
    );
  },

  webOrigin: () => getEnv().CORS_ORIGINS[0],
};

async function assertTenantIds(
  repos: UserRepos,
  officeIds: readonly string[] | undefined,
  roleIds: readonly string[] | undefined
): Promise<void> {
  const errors: { field: string; message: string }[] = [];
  if (officeIds?.length) {
    const found = await repos.users.existingOfficeIds(officeIds);
    officeIds.forEach((id, i) => {
      if (!found.has(id)) errors.push({ field: `officeIds.${i}`, message: 'invalid_reference' });
    });
  }
  if (roleIds?.length) {
    const found = await repos.roles.existingIds(roleIds);
    roleIds.forEach((id, i) => {
      if (!found.has(id)) errors.push({ field: `roleIds.${i}`, message: 'invalid_reference' });
    });
  }
  if (errors.length) throw new AppError('VALIDATION_ERROR', 'Unknown office or role', errors);
}

export class UserService {
  constructor(private readonly deps: UserServiceDeps = defaultUserDeps) {}

  list(ctx: RequestContext, query: UserListQuery): Promise<ListResponse<User>> {
    const pagination: Pagination = { page: query.page, pageSize: query.pageSize };
    const sort: Sort | undefined = query.sort;
    return this.deps.run(ctx, ({ users }) =>
      users.list({ status: query.status, q: query.q }, pagination, sort)
    );
  }

  get(ctx: RequestContext, membershipId: string): Promise<User> {
    return this.deps.run(ctx, ({ users }) => users.getById(membershipId));
  }

  async invite(ctx: RequestContext, body: UserInvite): Promise<User> {
    const officeIds = [...new Set(body.officeIds)];
    const roleIds = [...new Set(body.roleIds)];

    await this.deps.run(ctx, async (repos) => {
      await assertTenantIds(repos, officeIds, roleIds);
      if (await repos.users.findIdByEmail(body.email)) {
        throw new AppError('VALIDATION_ERROR', 'This email is already a member', [
          { field: 'email', message: 'already_member' },
        ]);
      }
    });

    // Outside the transaction: an HTTP call to Auth must not hold row locks.
    const origin = this.deps.webOrigin();
    const redirectTo = origin
      ? `${origin.replace(/\/$/, '')}/${body.locale}/accept-invite`
      : undefined;
    const userId = await this.deps.inviteAuthUser(body.email, redirectTo);

    return this.deps.run(ctx, async ({ users }) => {
      const membershipId = await users.insert({
        userId,
        email: body.email,
        fullNameAr: body.fullNameAr,
        fullNameEn: body.fullNameEn,
        positionTitle: body.positionTitle ?? null,
        orgWideAccess: body.orgWideAccess,
      });
      await users.syncOffices(membershipId, officeIds);
      await users.syncRoles(membershipId, roleIds);
      return users.getById(membershipId);
    });
  }

  update(ctx: RequestContext, membershipId: string, body: UserUpdate): Promise<User> {
    return this.deps.run(ctx, async (repos) => {
      const current = await repos.users.getById(membershipId);
      const officeIds = body.officeIds ? [...new Set(body.officeIds)] : undefined;
      const roleIds = body.roleIds ? [...new Set(body.roleIds)] : undefined;
      await assertTenantIds(repos, officeIds, roleIds);

      if (body.status === 'suspended' && membershipId === ctx.membershipId) {
        throw new AppError('VALIDATION_ERROR', 'You cannot suspend your own account', [
          { field: 'status', message: 'cannot_suspend_self' },
        ]);
      }

      // Reactivating someone who never accepted the invitation puts them back to `invited`.
      let status: MembershipStatus | undefined = body.status;
      if (status === 'active' && current.status === 'suspended' && !current.activatedAt) {
        status = 'invited';
      } else if (status === 'active' && current.status !== 'suspended') {
        status = undefined;
      }

      await repos.users.update(membershipId, {
        fullNameAr: body.fullNameAr,
        fullNameEn: body.fullNameEn,
        positionTitle: body.positionTitle,
        orgWideAccess: body.orgWideAccess,
        status,
      });
      if (officeIds) await repos.users.syncOffices(membershipId, officeIds);
      if (roleIds) await repos.users.syncRoles(membershipId, roleIds);
      return repos.users.getById(membershipId);
    });
  }
}
