// Permission catalogue (001 contracts/rls-and-permissions.md §3, 002 §2). Mirrors the
// `permission` rows seeded by migrations 0008 (001) and 0021 (002) — keep both in sync.
import type { DoaType, DocStepKind } from './doc-types';

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

/** 002 additions (research D8). */
export const PERMISSIONS_002 = {
  SUPPLIERS_READ: 'suppliers:read',
  SUPPLIERS_MANAGE: 'suppliers:manage',
  SUPPLIERS_VET: 'suppliers:vet',
  PROCUREMENT_READ: 'procurement:read',
  PROCUREMENT_CONFIGURE: 'procurement:configure',
  RFQ_CREATE: 'rfq:create',
  RFQ_ISSUE: 'rfq:issue',
  RFQ_OPEN: 'rfq:open',
  TENDER_MANAGE: 'tender:manage',
  TENDER_OPEN: 'tender:open',
  EVALUATION_SCORE: 'evaluation:score',
  EVALUATION_SIGN: 'evaluation:sign',
  AWARD_APPROVE: 'award:approve',
  WAIVER_CREATE: 'waiver:create',
  WAIVER_APPROVE: 'waiver:approve',
  PO_CREATE: 'po:create',
  PO_APPROVE: 'po:approve',
  PO_AMEND: 'po:amend',
  PO_CANCEL: 'po:cancel',
  PO_CLOSE: 'po:close',
  GRN_CREATE: 'grn:create',
  GRN_INSPECT: 'grn:inspect',
  INVOICE_REGISTER: 'invoice:register',
  PAYMENT_CREATE: 'payment:create',
  PAYMENT_CHECK: 'payment:check',
  PAYMENT_APPROVE: 'payment:approve',
  PAYMENT_OVERRIDE_MATCH: 'payment:override_match',
  VOUCHER_CREATE: 'voucher:create',
  VOUCHER_CHECK: 'voucher:check',
  VOUCHER_APPROVE: 'voucher:approve',
  VOUCHER_POST: 'voucher:post',
  VOUCHER_REVERSE: 'voucher:reverse',
  ACCOUNTS_MANAGE: 'accounts:manage',
  PERIODS_MANAGE: 'periods:manage',
  BANK_MANAGE: 'bank:manage',
  BANK_RECONCILE: 'bank:reconcile',
  ADVANCE_REQUEST: 'advance:request',
  ADVANCE_APPROVE: 'advance:approve',
  ADVANCE_SETTLE: 'advance:settle',
  ALLOCATION_MANAGE: 'allocation:manage',
  FINANCE_READ: 'finance:read',
  REPORTS_READ: 'reports:read',
  REPORTS_FINANCE: 'reports:finance',
} as const;

export type Permission =
  | (typeof PERMISSIONS)[keyof typeof PERMISSIONS]
  | (typeof PERMISSIONS_002)[keyof typeof PERMISSIONS_002];

/** The 001 catalogue: what the five 001 system roles are built from (SEEDED_ROLES). */
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

export const PERMISSIONS_002_LIST: readonly Permission[] = Object.values(PERMISSIONS_002);

/** Every permission code, 001 and 002. */
export const PERMISSION_CATALOGUE: readonly Permission[] = [
  ...ALL_PERMISSIONS,
  ...PERMISSIONS_002_LIST,
];

export function isPermission(value: string): value is Permission {
  return (PERMISSION_CATALOGUE as readonly string[]).includes(value);
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

// The permission a step's required role must grant for its holders to be eligible (PR routes).
export const STEP_KIND_PERMISSION: Record<StepKind, Permission> = {
  finance_check: P.PR_FINANCE_CHECK,
  approval: P.PR_APPROVE,
  final_approval: P.PR_APPROVE,
};

// ---------------------------------------------------------------------------------------------
// 002 roles (contracts/rls-and-permissions.md §4)
// ---------------------------------------------------------------------------------------------

const Q = PERMISSIONS_002;

/** Permissions the organization admin never holds: every signing permission (Principle II). */
export const ADMIN_EXCLUDED_PERMISSIONS_002: readonly Permission[] = [
  Q.AWARD_APPROVE,
  Q.PO_APPROVE,
  Q.WAIVER_APPROVE,
  Q.PAYMENT_CHECK,
  Q.PAYMENT_APPROVE,
  Q.VOUCHER_CHECK,
  Q.VOUCHER_APPROVE,
  Q.EVALUATION_SCORE,
  Q.EVALUATION_SIGN,
  Q.ADVANCE_APPROVE,
  Q.GRN_INSPECT,
];

export type SeededRoleKey002 =
  | 'procurement_officer'
  | 'committee_member'
  | 'storekeeper'
  | 'technical_inspector'
  | 'accountant'
  | 'finance_manager'
  | 'cashier'
  | 'country_director';

export interface SeededRole002 {
  key: SeededRoleKey002;
  nameAr: string;
  nameEn: string;
  permissions: readonly Permission[];
}

// Seeded per organization by migration 0021 (app.seed_doc_defaults_002) — keep both in sync.
export const SEEDED_ROLES_002: Record<SeededRoleKey002, SeededRole002> = {
  procurement_officer: {
    key: 'procurement_officer',
    nameAr: 'مسؤول المشتريات',
    nameEn: 'Procurement Officer',
    permissions: [
      P.PR_READ,
      Q.PROCUREMENT_READ,
      Q.SUPPLIERS_READ,
      Q.SUPPLIERS_MANAGE,
      Q.RFQ_CREATE,
      Q.RFQ_ISSUE,
      Q.RFQ_OPEN,
      Q.TENDER_MANAGE,
      Q.TENDER_OPEN,
      Q.WAIVER_CREATE,
      Q.PO_CREATE,
      Q.PO_AMEND,
      Q.PO_CANCEL,
      Q.PO_CLOSE,
      Q.REPORTS_READ,
    ],
  },
  committee_member: {
    key: 'committee_member',
    nameAr: 'عضو لجنة',
    nameEn: 'Committee Member',
    permissions: [Q.PROCUREMENT_READ, Q.EVALUATION_SCORE, Q.EVALUATION_SIGN],
  },
  storekeeper: {
    key: 'storekeeper',
    nameAr: 'أمين المخزن / المستلم',
    nameEn: 'Storekeeper / Receiver',
    permissions: [Q.PROCUREMENT_READ, Q.GRN_CREATE],
  },
  technical_inspector: {
    key: 'technical_inspector',
    nameAr: 'المفتش الفني',
    nameEn: 'Technical Inspector',
    permissions: [Q.PROCUREMENT_READ, Q.GRN_INSPECT],
  },
  accountant: {
    key: 'accountant',
    nameAr: 'المحاسب',
    nameEn: 'Accountant',
    permissions: [
      Q.PROCUREMENT_READ,
      Q.FINANCE_READ,
      Q.INVOICE_REGISTER,
      Q.PAYMENT_CREATE,
      Q.VOUCHER_CREATE,
      Q.VOUCHER_POST,
      Q.ADVANCE_SETTLE,
      P.BUDGET_READ,
      Q.REPORTS_READ,
      Q.REPORTS_FINANCE,
    ],
  },
  finance_manager: {
    key: 'finance_manager',
    nameAr: 'المدير المالي',
    nameEn: 'Finance Manager',
    permissions: [
      Q.FINANCE_READ,
      Q.PROCUREMENT_READ,
      Q.SUPPLIERS_VET,
      Q.PAYMENT_CHECK,
      Q.PAYMENT_OVERRIDE_MATCH,
      Q.VOUCHER_CHECK,
      Q.VOUCHER_REVERSE,
      Q.ACCOUNTS_MANAGE,
      Q.PERIODS_MANAGE,
      Q.BANK_MANAGE,
      Q.BANK_RECONCILE,
      Q.ALLOCATION_MANAGE,
      Q.AWARD_APPROVE,
      Q.PO_APPROVE,
      Q.WAIVER_APPROVE,
      Q.ADVANCE_APPROVE,
      P.RATES_MANAGE,
      P.BUDGET_READ,
      Q.REPORTS_READ,
      Q.REPORTS_FINANCE,
    ],
  },
  cashier: {
    key: 'cashier',
    nameAr: 'أمين الصندوق',
    nameEn: 'Cashier',
    permissions: [Q.FINANCE_READ, Q.VOUCHER_CREATE, Q.VOUCHER_POST, Q.BANK_MANAGE],
  },
  country_director: {
    key: 'country_director',
    nameAr: 'المدير القطري / المفوض بالتوقيع',
    nameEn: 'Country Director / Authorized Signatory',
    permissions: [
      Q.PROCUREMENT_READ,
      Q.FINANCE_READ,
      Q.AWARD_APPROVE,
      Q.PO_APPROVE,
      Q.WAIVER_APPROVE,
      Q.PAYMENT_APPROVE,
      Q.VOUCHER_APPROVE,
      Q.ADVANCE_APPROVE,
      Q.REPORTS_READ,
      Q.REPORTS_FINANCE,
    ],
  },
};

/** What 0021 adds to the 001 system roles of every organization. */
export const SEEDED_ROLE_ADDITIONS_002: Partial<Record<SeededRoleKey, readonly Permission[]>> = {
  org_admin: PERMISSIONS_002_LIST.filter((p) => !ADMIN_EXCLUDED_PERMISSIONS_002.includes(p)),
  requester: [Q.ADVANCE_REQUEST],
  viewer: [Q.PROCUREMENT_READ, Q.FINANCE_READ, Q.SUPPLIERS_READ, Q.REPORTS_READ, Q.REPORTS_FINANCE],
};

/** A 001 role's permissions once 0021 has run for its organization. */
export function seededRolePermissions002(key: SeededRoleKey): readonly Permission[] {
  return [...SEEDED_ROLES[key].permissions, ...(SEEDED_ROLE_ADDITIONS_002[key] ?? [])];
}

// ---------------------------------------------------------------------------------------------
// Step kind → permission per DoA type (rls-and-permissions.md §2)
// ---------------------------------------------------------------------------------------------

interface StepPermissions {
  /** finance_check and check; null = the type's routes have no checking step */
  check: Permission | null;
  /** approval and final_approval */
  approve: Permission;
}

export const DOA_STEP_PERMISSIONS: Record<DoaType, StepPermissions> = {
  PR: { check: P.PR_FINANCE_CHECK, approve: P.PR_APPROVE },
  AWARD: { check: null, approve: Q.AWARD_APPROVE },
  PO: { check: null, approve: Q.PO_APPROVE },
  CON: { check: null, approve: Q.PO_APPROVE },
  AMD: { check: null, approve: Q.PO_APPROVE },
  WAIVER: { check: null, approve: Q.WAIVER_APPROVE },
  PAY: { check: Q.PAYMENT_CHECK, approve: Q.PAYMENT_APPROVE },
  DPR: { check: Q.PAYMENT_CHECK, approve: Q.PAYMENT_APPROVE },
  PV: { check: Q.VOUCHER_CHECK, approve: Q.VOUCHER_APPROVE },
  RV: { check: Q.VOUCHER_CHECK, approve: Q.VOUCHER_APPROVE },
  JV: { check: Q.VOUCHER_CHECK, approve: Q.VOUCHER_APPROVE },
  ADV: { check: null, approve: Q.ADVANCE_APPROVE },
  STL: { check: null, approve: Q.ADVANCE_APPROVE },
};

/**
 * The permission the step's role must grant; null when the type has no such step kind (a rule
 * using it cannot be signed by anyone).
 */
export function stepPermission(doaType: DoaType, kind: DocStepKind): Permission | null {
  const map = DOA_STEP_PERMISSIONS[doaType];
  return kind === 'finance_check' || kind === 'check' ? map.check : map.approve;
}
