// Permission catalogue (contracts/rls-and-permissions.md §3). Mirrors the `permission` rows seeded
// by packages/database/migrations/0008_seed_reference.sql — keep both in sync.

export const PERMISSIONS = {
  SETTINGS_MANAGE: 'settings:manage',
  USERS_MANAGE: 'users:manage',
  ROLES_MANAGE: 'roles:manage',
  GRANTS_MANAGE: 'grants:manage',
  RATES_MANAGE: 'rates:manage',
  BUDGET_READ: 'budget:read',
  PR_READ: 'pr:read',
  PR_CREATE: 'pr:create',
  PR_FINANCE_CHECK: 'pr:finance_check',
  PR_APPROVE: 'pr:approve',
  PR_CANCEL_APPROVED: 'pr:cancel_approved',
  PR_REASSIGN: 'pr:reassign',
  AUDIT_READ: 'audit:read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

export type SeededRoleKey = 'org_admin' | 'requester' | 'finance_checker' | 'approver' | 'viewer';

export interface SeededRole {
  key: SeededRoleKey;
  nameAr: string;
  nameEn: string;
  permissions: readonly Permission[];
}

const P = PERMISSIONS;

// Seeded on tenant creation (contracts/rls-and-permissions.md §4). The admin deliberately lacks the
// signing permissions so administration and approval stay separate (Principle II).
export const SEEDED_ROLES: Record<SeededRoleKey, SeededRole> = {
  org_admin: {
    key: 'org_admin',
    nameAr: 'مدير المنظمة',
    nameEn: 'Organization Admin',
    permissions: ALL_PERMISSIONS.filter((p) => p !== P.PR_FINANCE_CHECK && p !== P.PR_APPROVE),
  },
  requester: {
    key: 'requester',
    nameAr: 'مقدم الطلب',
    nameEn: 'Requester',
    permissions: [P.PR_READ, P.PR_CREATE],
  },
  finance_checker: {
    key: 'finance_checker',
    nameAr: 'المدقق المالي',
    nameEn: 'Finance Checker',
    permissions: [P.PR_READ, P.PR_FINANCE_CHECK, P.BUDGET_READ, P.RATES_MANAGE],
  },
  approver: {
    key: 'approver',
    nameAr: 'المعتمد',
    nameEn: 'Approver',
    permissions: [P.PR_READ, P.PR_APPROVE, P.BUDGET_READ],
  },
  viewer: {
    key: 'viewer',
    nameAr: 'مشاهد / مدقق',
    nameEn: 'Viewer / Auditor',
    permissions: [P.PR_READ, P.BUDGET_READ, P.AUDIT_READ],
  },
};

export type StepKind = 'finance_check' | 'approval' | 'final_approval';

// The permission a step's required role must grant for its holders to be eligible.
export const STEP_KIND_PERMISSION: Record<StepKind, Permission> = {
  finance_check: P.PR_FINANCE_CHECK,
  approval: P.PR_APPROVE,
  final_approval: P.PR_APPROVE,
};
