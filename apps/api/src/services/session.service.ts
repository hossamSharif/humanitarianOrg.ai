// GET /me and POST /session/tenant (research R2, R17). The active organization is
// app_metadata.tenant_id, written only here through the Auth admin API; RLS still checks the
// membership on every statement, so a stale or forged claim grants nothing.
import { isPermission, type Permission } from '@ngo/shared';
import { adminAuth } from '../db/supabase';
import { withTenantTx, type TxSql } from '../db/tx';
import { AppError } from '../middleware/error';
import type { AuthInfo } from '../types/context';

export interface MembershipSummary {
  membershipId: string;
  tenantId: string;
  tenantNameAr: string;
  tenantNameEn: string;
  status: 'invited' | 'active';
}

export interface OfficeSummary {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
}

export interface MeResponse {
  user: { id: string; email: string | null };
  tenantId: string | null;
  membership: {
    id: string;
    fullNameAr: string;
    fullNameEn: string;
    positionTitle: string | null;
    email: string;
  } | null;
  memberships: MembershipSummary[];
  permissions: Permission[];
  offices: OfficeSummary[];
  orgWideAccess: boolean;
  /** true when the server changed app_metadata.tenant_id: the client must refresh its session */
  sessionRefreshRequired: boolean;
}

export interface SessionDeps {
  run<T>(
    claims: Record<string, unknown>,
    requestId: string,
    fn: (sql: TxSql) => Promise<T>
  ): Promise<T>;
  setTenantClaim(userId: string, tenantId: string): Promise<void>;
}

export const defaultSessionDeps: SessionDeps = {
  run: (claims, requestId, fn) => withTenantTx({ claims, requestId }, ({ sql }) => fn(sql)),
  async setTenantClaim(userId, tenantId) {
    const { error } = await adminAuth().updateUserById(userId, {
      app_metadata: { tenant_id: tenantId },
    });
    if (error)
      throw new AppError('INTERNAL_ERROR', `Could not set active organization: ${error.message}`);
  },
};

function claimTenantId(claims: Record<string, unknown>): string | undefined {
  const meta = claims.app_metadata;
  if (meta && typeof meta === 'object' && 'tenant_id' in meta) {
    const value = (meta as Record<string, unknown>).tenant_id;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

/** Claims as they will be after the client refreshes; only used for an already-verified tenant. */
function withTenantClaim(
  claims: Record<string, unknown>,
  tenantId: string
): Record<string, unknown> {
  const meta = (claims.app_metadata as Record<string, unknown> | undefined) ?? {};
  return { ...claims, app_metadata: { ...meta, tenant_id: tenantId } };
}

async function myMemberships(sql: TxSql): Promise<MembershipSummary[]> {
  const rows = await sql<
    {
      membership_id: string;
      tenant_id: string;
      tenant_name_ar: string;
      tenant_name_en: string;
      status: 'invited' | 'active';
    }[]
  >`select * from app.my_memberships()`;
  return rows.map((r) => ({
    membershipId: r.membership_id,
    tenantId: r.tenant_id,
    tenantNameAr: r.tenant_name_ar,
    tenantNameEn: r.tenant_name_en,
    status: r.status,
  }));
}

export class SessionService {
  constructor(private readonly deps: SessionDeps = defaultSessionDeps) {}

  async getMe(auth: AuthInfo, requestId: string): Promise<MeResponse> {
    const { run } = this.deps;

    // First sign-in after an invitation activates the caller's memberships.
    const memberships = await run(auth.claims, requestId, async (sql) => {
      const current = await myMemberships(sql);
      if (!current.some((m) => m.status === 'invited')) return current;
      await sql`select app.accept_invitations()`;
      return myMemberships(sql);
    });

    const active = memberships.filter((m) => m.status === 'active');
    const claimed = claimTenantId(auth.claims);
    let tenantId = active.find((m) => m.tenantId === claimed)?.tenantId ?? null;
    let sessionRefreshRequired = false;

    if (!tenantId && active[0]) {
      tenantId = active[0].tenantId;
      await this.deps.setTenantClaim(auth.userId, tenantId);
      sessionRefreshRequired = true;
    }

    const base: MeResponse = {
      user: { id: auth.userId, email: auth.email },
      tenantId,
      membership: null,
      memberships,
      permissions: [],
      offices: [],
      orgWideAccess: false,
      sessionRefreshRequired,
    };
    if (!tenantId) return base;

    return run(withTenantClaim(auth.claims, tenantId), requestId, async (sql) => {
      const [ctxRow] = await sql<
        {
          ctx: {
            membershipId: string;
            orgWideAccess: boolean;
            permissions: string[];
            officeIds: string[];
          } | null;
        }[]
      >`select app.session_context() as ctx`;
      const ctx = ctxRow?.ctx;
      if (!ctx) return base;

      const [membership] = await sql<
        {
          id: string;
          full_name_ar: string;
          full_name_en: string;
          position_title: string | null;
          email: string;
        }[]
      >`
        select id, full_name_ar, full_name_en, position_title, email::text as email
        from public.membership where id = ${ctx.membershipId}`;

      const offices = ctx.officeIds.length
        ? await sql<
            { id: string; code: string; name_ar: string; name_en: string; is_active: boolean }[]
          >`
            select id, code, name_ar, name_en, is_active
            from public.office where id in ${sql(ctx.officeIds)} order by code`
        : [];

      return {
        ...base,
        membership: membership
          ? {
              id: membership.id,
              fullNameAr: membership.full_name_ar,
              fullNameEn: membership.full_name_en,
              positionTitle: membership.position_title,
              email: membership.email,
            }
          : null,
        permissions: ctx.permissions.filter(isPermission),
        offices: offices.map((o) => ({
          id: o.id,
          code: o.code,
          nameAr: o.name_ar,
          nameEn: o.name_en,
          isActive: o.is_active,
        })),
        orgWideAccess: ctx.orgWideAccess,
      };
    });
  }

  async switchTenant(
    auth: AuthInfo,
    requestId: string,
    tenantId: string
  ): Promise<{ tenantId: string; sessionRefreshRequired: true }> {
    const memberships = await this.deps.run(auth.claims, requestId, myMemberships);
    if (!memberships.some((m) => m.tenantId === tenantId && m.status === 'active')) {
      throw new AppError('FORBIDDEN', 'No active membership in that organization');
    }
    await this.deps.setTenantClaim(auth.userId, tenantId);
    return { tenantId, sessionRefreshRequired: true };
  }
}
