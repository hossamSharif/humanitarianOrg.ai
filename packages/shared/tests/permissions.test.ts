// T010 — the 002 permission catalogue, seeded role matrix and step-kind map
// (contracts/rls-and-permissions.md §2 and §4, research D8).
import { describe, expect, it } from 'vitest';
import { DOA_TYPES, type DoaType } from '../src/doc-types';
import {
  ADMIN_EXCLUDED_PERMISSIONS_002,
  ALL_PERMISSIONS,
  PERMISSIONS_002_LIST,
  PERMISSION_CATALOGUE,
  SEEDED_ROLES,
  SEEDED_ROLES_002,
  isPermission,
  seededRolePermissions002,
  stepPermission,
} from '../src/permissions';

// rls-and-permissions.md §2, in table order
const CATALOGUE_002 = [
  'suppliers:read',
  'suppliers:manage',
  'suppliers:vet',
  'procurement:read',
  'procurement:configure',
  'rfq:create',
  'rfq:issue',
  'rfq:open',
  'tender:manage',
  'tender:open',
  'evaluation:score',
  'evaluation:sign',
  'award:approve',
  'waiver:create',
  'waiver:approve',
  'po:create',
  'po:approve',
  'po:amend',
  'po:cancel',
  'po:close',
  'grn:create',
  'grn:inspect',
  'invoice:register',
  'payment:create',
  'payment:check',
  'payment:approve',
  'payment:override_match',
  'voucher:create',
  'voucher:check',
  'voucher:approve',
  'voucher:post',
  'voucher:reverse',
  'accounts:manage',
  'periods:manage',
  'bank:manage',
  'bank:reconcile',
  'advance:request',
  'advance:approve',
  'advance:settle',
  'allocation:manage',
  'finance:read',
  'reports:read',
  'reports:finance',
];

// rls-and-permissions.md §4
const ROLE_MATRIX: Record<string, string[]> = {
  procurement_officer: [
    'pr:read',
    'procurement:read',
    'suppliers:read',
    'suppliers:manage',
    'rfq:create',
    'rfq:issue',
    'rfq:open',
    'tender:manage',
    'tender:open',
    'waiver:create',
    'po:create',
    'po:amend',
    'po:cancel',
    'po:close',
    'reports:read',
  ],
  committee_member: ['procurement:read', 'evaluation:score', 'evaluation:sign'],
  storekeeper: ['procurement:read', 'grn:create'],
  technical_inspector: ['procurement:read', 'grn:inspect'],
  accountant: [
    'procurement:read',
    'finance:read',
    'invoice:register',
    'payment:create',
    'voucher:create',
    'voucher:post',
    'advance:settle',
    'budget:read',
    'reports:read',
    'reports:finance',
  ],
  finance_manager: [
    'finance:read',
    'procurement:read',
    'suppliers:vet',
    'payment:check',
    'payment:override_match',
    'voucher:check',
    'voucher:reverse',
    'accounts:manage',
    'periods:manage',
    'bank:manage',
    'bank:reconcile',
    'allocation:manage',
    'award:approve',
    'po:approve',
    'waiver:approve',
    'advance:approve',
    'rates:manage',
    'budget:read',
    'reports:read',
    'reports:finance',
  ],
  cashier: ['finance:read', 'voucher:create', 'voucher:post', 'bank:manage'],
  country_director: [
    'procurement:read',
    'finance:read',
    'award:approve',
    'po:approve',
    'waiver:approve',
    'payment:approve',
    'voucher:approve',
    'advance:approve',
    'reports:read',
    'reports:finance',
  ],
};

const ADMIN_NEVER = [
  'award:approve',
  'po:approve',
  'waiver:approve',
  'payment:check',
  'payment:approve',
  'voucher:check',
  'voucher:approve',
  'evaluation:score',
  'evaluation:sign',
  'advance:approve',
  'grn:inspect',
];

const sorted = (values: readonly string[]) => [...values].sort();

describe('permission catalogue (§2)', () => {
  it('contains every 002 code exactly once', () => {
    expect(sorted(PERMISSIONS_002_LIST)).toEqual(sorted(CATALOGUE_002));
    expect(new Set(PERMISSION_CATALOGUE).size).toBe(PERMISSION_CATALOGUE.length);
  });

  it('keeps the 001 catalogue unchanged and accepts both in isPermission', () => {
    expect(ALL_PERMISSIONS).toHaveLength(13);
    for (const code of [...ALL_PERMISSIONS, ...CATALOGUE_002])
      expect(isPermission(code)).toBe(true);
    expect(isPermission('po:delete')).toBe(false);
  });
});

describe('seeded roles (§4)', () => {
  it.each(Object.entries(ROLE_MATRIX))('%s has exactly its listed permissions', (key, codes) => {
    const role = SEEDED_ROLES_002[key as keyof typeof SEEDED_ROLES_002];
    expect(role).toBeDefined();
    expect(sorted(role.permissions)).toEqual(sorted(codes));
  });

  it('seeds exactly the eight new roles with distinct names', () => {
    expect(sorted(Object.keys(SEEDED_ROLES_002))).toEqual(sorted(Object.keys(ROLE_MATRIX)));
    const all = [...Object.values(SEEDED_ROLES), ...Object.values(SEEDED_ROLES_002)];
    expect(new Set(all.map((r) => r.nameEn)).size).toBe(all.length);
    expect(new Set(all.map((r) => r.nameAr)).size).toBe(all.length);
  });

  it('org_admin holds every new non-signing permission and none of the signing ones', () => {
    const admin = seededRolePermissions002('org_admin');
    expect(sorted(ADMIN_EXCLUDED_PERMISSIONS_002)).toEqual(sorted(ADMIN_NEVER));
    for (const code of ADMIN_NEVER) expect(admin).not.toContain(code);
    for (const code of CATALOGUE_002.filter((c) => !ADMIN_NEVER.includes(c))) {
      expect(admin).toContain(code);
    }
    // the 001 signing permissions stay excluded too
    expect(admin).not.toContain('pr:approve');
    expect(admin).not.toContain('pr:finance_check');
  });

  it('requester gains advance:request; viewer gains the read and report permissions', () => {
    expect(seededRolePermissions002('requester')).toContain('advance:request');
    expect(sorted(seededRolePermissions002('viewer'))).toEqual(
      sorted([
        ...SEEDED_ROLES.viewer.permissions,
        'procurement:read',
        'finance:read',
        'suppliers:read',
        'reports:read',
        'reports:finance',
      ])
    );
  });

  it('the 001 roles themselves are unchanged (regression gate)', () => {
    expect(sorted(Object.keys(SEEDED_ROLES))).toEqual(
      sorted(['org_admin', 'requester', 'finance_checker', 'approver', 'viewer'])
    );
    expect(SEEDED_ROLES.org_admin.permissions).toHaveLength(ALL_PERMISSIONS.length - 2);
  });
});

describe('step kind → permission per DoA type (§2)', () => {
  const expected: Record<DoaType, [string | null, string]> = {
    PR: ['pr:finance_check', 'pr:approve'],
    AWARD: [null, 'award:approve'],
    PO: [null, 'po:approve'],
    CON: [null, 'po:approve'],
    AMD: [null, 'po:approve'],
    WAIVER: [null, 'waiver:approve'],
    PAY: ['payment:check', 'payment:approve'],
    DPR: ['payment:check', 'payment:approve'],
    PV: ['voucher:check', 'voucher:approve'],
    RV: ['voucher:check', 'voucher:approve'],
    JV: ['voucher:check', 'voucher:approve'],
    ADV: [null, 'advance:approve'],
    STL: [null, 'advance:approve'],
  };

  it.each(DOA_TYPES)('%s', (doaType) => {
    const [check, approve] = expected[doaType];
    expect(stepPermission(doaType, 'finance_check')).toBe(check);
    expect(stepPermission(doaType, 'check')).toBe(check);
    expect(stepPermission(doaType, 'approval')).toBe(approve);
    expect(stepPermission(doaType, 'final_approval')).toBe(approve);
  });

  it('the default approvers can sign the default routes (research D8)', () => {
    const fm = SEEDED_ROLES_002.finance_manager.permissions;
    const cd = SEEDED_ROLES_002.country_director.permissions;
    for (const t of ['AWARD', 'PO', 'CON', 'AMD', 'WAIVER'] as const) {
      expect(fm).toContain(stepPermission(t, 'approval'));
      expect(cd).toContain(stepPermission(t, 'final_approval'));
    }
    for (const t of ['PAY', 'DPR'] as const) {
      expect(fm).toContain(stepPermission(t, 'finance_check'));
      expect(cd).toContain(stepPermission(t, 'final_approval'));
    }
    for (const t of ['PV', 'RV', 'JV'] as const) {
      expect(fm).toContain(stepPermission(t, 'check'));
      expect(cd).toContain(stepPermission(t, 'final_approval'));
    }
    for (const t of ['ADV', 'STL'] as const) {
      expect(fm).toContain(stepPermission(t, 'final_approval'));
    }
  });
});
