// User (membership) bodies (contracts/rest-api.md "Users, roles, approval rules").
import { z } from 'zod';
import { listQuery, uuid } from './common';
import type { Permission } from '../permissions';

export const membershipStatus = z.enum(['invited', 'active', 'suspended']);
export type MembershipStatus = z.infer<typeof membershipStatus>;

const name = z.string().trim().min(1).max(200);

/** Optional free text; an empty string means "not set". */
const positionTitle = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

const ids = z.array(uuid).max(200);

export const userInvite = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  fullNameAr: name,
  fullNameEn: name,
  positionTitle,
  officeIds: ids.default([]),
  roleIds: ids.min(1, 'At least one role is required'),
  orgWideAccess: z.boolean().default(false),
  /** language of the accept-invite page the email links to */
  locale: z.enum(['ar', 'en']).default('ar'),
});

/** PATCH: any invite field except the email, plus suspend / reactivate. */
export const userUpdate = z.object({
  fullNameAr: name.optional(),
  fullNameEn: name.optional(),
  positionTitle: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
  officeIds: ids.optional(),
  roleIds: ids.min(1, 'At least one role is required').optional(),
  orgWideAccess: z.boolean().optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

export const userListQuery = listQuery.extend({
  status: membershipStatus.optional(),
  q: z.string().trim().max(200).optional(),
});

export const membershipIdParam = z.object({ membershipId: uuid });

export type UserInvite = z.infer<typeof userInvite>;
export type UserInviteInput = z.input<typeof userInvite>;
export type UserUpdate = z.infer<typeof userUpdate>;
export type UserListQuery = z.infer<typeof userListQuery>;

export interface UserRoleRef {
  id: string;
  nameAr: string;
  nameEn: string;
}

export interface UserOfficeRef {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
}

/** GET /users item: a membership with its roles and offices. */
export interface User {
  membershipId: string;
  userId: string;
  email: string;
  fullNameAr: string;
  fullNameEn: string;
  positionTitle: string | null;
  orgWideAccess: boolean;
  status: MembershipStatus;
  invitedAt: string | null;
  activatedAt: string | null;
  roles: UserRoleRef[];
  offices: UserOfficeRef[];
  /** union of the roles' permissions */
  permissions: Permission[];
}
