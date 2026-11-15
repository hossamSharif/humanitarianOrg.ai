// Loads the caller's tenant context once per request: active membership in the token's
// app_metadata.tenant_id, permissions and office access (app.session_context(), one round trip).
import { isPermission, type Permission } from '@ngo/shared';
import type { RequestHandler } from 'express';
import { withTenantTx } from '../db/tx';
import { AppError } from './error';

interface SessionContextRow {
  membershipId: string;
  tenantId: string;
  orgWideAccess: boolean;
  permissions: string[];
  officeIds: string[];
}

export type SessionContextLoader = (
  claims: Record<string, unknown>,
  requestId: string
) => Promise<SessionContextRow | null>;

export const loadSessionContext: SessionContextLoader = (claims, requestId) =>
  withTenantTx({ claims, requestId }, async ({ sql }) => {
    const [row] = await sql<{ ctx: SessionContextRow | null }[]>`
      select app.session_context() as ctx`;
    return row?.ctx ?? null;
  });

export function tenantContext(load: SessionContextLoader = loadSessionContext): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.auth) throw new AppError('UNAUTHORIZED', 'Not authenticated');
      const session = await load(req.auth.claims, req.requestId);
      if (!session) {
        throw new AppError('FORBIDDEN', 'No active membership in the selected organization');
      }
      req.ctx = {
        requestId: req.requestId,
        userId: req.auth.userId,
        email: req.auth.email,
        tenantId: session.tenantId,
        membershipId: session.membershipId,
        permissions: new Set(session.permissions.filter(isPermission)),
        officeIds: session.officeIds,
        orgWideAccess: session.orgWideAccess,
        claims: req.auth.claims,
        accessToken: req.auth.accessToken,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function hasPermission(req: Express.Request, code: Permission): boolean {
  return req.ctx?.permissions.has(code) ?? false;
}
