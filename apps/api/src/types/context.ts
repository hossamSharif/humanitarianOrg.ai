// Per-request identity, attached by the auth and tenant middleware.
import type { Permission } from '@ngo/shared';

export interface AuthInfo {
  userId: string;
  email: string | null;
  /** Verified JWT payload; forwarded to Postgres as request.jwt.claims. */
  claims: Record<string, unknown>;
  accessToken: string;
}

export interface RequestContext {
  requestId: string;
  userId: string;
  email: string | null;
  tenantId: string;
  membershipId: string;
  permissions: ReadonlySet<Permission>;
  officeIds: readonly string[];
  orgWideAccess: boolean;
  claims: Record<string, unknown>;
  accessToken: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthInfo;
      ctx?: RequestContext;
    }
  }
}
