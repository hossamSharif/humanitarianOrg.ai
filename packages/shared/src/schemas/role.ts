// Role bodies: a role is an editable permission set (FR-017).
import { z } from 'zod';
import { ALL_PERMISSIONS, type Permission } from '../permissions';

const permissionCode = z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]]);

const name = z.string().trim().min(1).max(100);

export const roleCreate = z.object({
  nameAr: name,
  nameEn: name,
  permissions: z
    .array(permissionCode)
    .max(ALL_PERMISSIONS.length * 2)
    .transform((codes) => [...new Set(codes)]),
});

export const roleUpdate = roleCreate.partial();

export type RoleCreate = z.infer<typeof roleCreate>;
export type RoleUpdate = z.infer<typeof roleUpdate>;

export interface Role {
  id: string;
  key: string | null;
  nameAr: string;
  nameEn: string;
  isSystem: boolean;
  permissions: Permission[];
  /** memberships holding the role */
  memberCount: number;
  /** approval rule steps requiring the role */
  ruleStepCount: number;
}

/** GET /permissions item. */
export interface PermissionInfo {
  code: Permission;
  descriptionAr: string;
  descriptionEn: string;
}

/** `pr:approve` → `pr` — the UI groups the checklist by resource. */
export function permissionResource(code: Permission): string {
  return code.split(':')[0] ?? code;
}
