// Test data builders with RTHA-flavoured defaults (PR 0010: Madani office, ADRA grant in USD,
// budget line 10202). Override any field per test.
import { randomUUID } from 'node:crypto';
import type { Permission, PrStatus, StepKind } from '@ngo/shared';
import type { RequestContext } from '../../../src/types/context';

export const TENANT_ID = '00000000-0000-4000-8000-00000000a001';
export const OTHER_TENANT_ID = '00000000-0000-4000-8000-00000000b001';
export const MAD_OFFICE_ID = '00000000-0000-4000-8000-0000000000f1';
export const KST_OFFICE_ID = '00000000-0000-4000-8000-0000000000f2';

export function buildContext(overrides: Partial<RequestContext> = {}): RequestContext {
  const userId = overrides.userId ?? randomUUID();
  return {
    requestId: 'test-request',
    userId,
    email: 'requester@example.org',
    tenantId: TENANT_ID,
    membershipId: randomUUID(),
    permissions: new Set<Permission>(['pr:read', 'pr:create']),
    officeIds: [MAD_OFFICE_ID],
    orgWideAccess: false,
    claims: { sub: userId, role: 'authenticated', app_metadata: { tenant_id: TENANT_ID } },
    accessToken: 'test-token',
    ...overrides,
  };
}

export interface BudgetLineFixture {
  id: string;
  tenantId: string;
  grantId: string;
  code: string;
  description: string;
  category: 'supplies' | 'services' | 'staff' | 'equipment' | 'running_costs';
  budgetAmount: string;
  officeId: string | null;
  isActive: boolean;
  version: number;
}

export function buildBudgetLine(overrides: Partial<BudgetLineFixture> = {}): BudgetLineFixture {
  return {
    id: randomUUID(),
    tenantId: TENANT_ID,
    grantId: randomUUID(),
    code: '10202',
    description: 'Hygiene kits',
    category: 'supplies',
    budgetAmount: '10000.00',
    officeId: MAD_OFFICE_ID,
    isActive: true,
    version: 1,
    ...overrides,
  };
}

export interface PrLineFixture {
  id: string;
  lineNo: number;
  description: string;
  quantity: string;
  unitId: string;
  unitCost: string;
  lineTotal: string;
  currency: string;
  budgetLineId: string;
  locationOfficeId: string;
  activityId: string | null;
}

export function buildPrLine(overrides: Partial<PrLineFixture> = {}): PrLineFixture {
  const quantity = overrides.quantity ?? '10';
  const unitCost = overrides.unitCost ?? '87071.00';
  return {
    id: randomUUID(),
    lineNo: 1,
    description: 'Jerrycan 20 L',
    quantity,
    unitId: randomUUID(),
    unitCost,
    // caller passes lineTotal when it matters; tests of rounding compute it with @ngo/shared
    lineTotal: '870710.00',
    currency: 'SDG',
    budgetLineId: randomUUID(),
    locationOfficeId: MAD_OFFICE_ID,
    activityId: null,
    ...overrides,
  };
}

export interface PrFixture {
  id: string;
  tenantId: string;
  number: string | null;
  status: PrStatus;
  version: number;
  prDate: string;
  requestingOfficeId: string;
  grantId: string;
  deliverToOfficeId: string;
  requiredByDate: string | null;
  prType: 'goods' | 'services' | 'mixed';
  requesterId: string;
  submissionCycle: number;
  currentStepOrder: number | null;
  lines: PrLineFixture[];
}

export function buildPr(overrides: Partial<PrFixture> = {}): PrFixture {
  return {
    id: randomUUID(),
    tenantId: TENANT_ID,
    number: null,
    status: 'draft',
    version: 1,
    prDate: '2026-11-10',
    requestingOfficeId: MAD_OFFICE_ID,
    grantId: randomUUID(),
    deliverToOfficeId: MAD_OFFICE_ID,
    requiredByDate: '2026-11-30',
    prType: 'goods',
    requesterId: randomUUID(),
    submissionCycle: 0,
    currentStepOrder: null,
    lines: [buildPrLine()],
    ...overrides,
  };
}

export interface RuleStepFixture {
  id: string;
  stepOrder: number;
  kind: StepKind;
  roleId: string;
  minAmount: string | null;
  maxAmount: string | null;
}

export interface RuleFixture {
  id: string;
  tenantId: string;
  docType: 'PR';
  officeId: string | null;
  name: string;
  isActive: boolean;
  steps: RuleStepFixture[];
}

/** Seeded default: finance check → one open final-approval band. */
export function buildRule(overrides: Partial<RuleFixture> = {}): RuleFixture {
  return {
    id: randomUUID(),
    tenantId: TENANT_ID,
    docType: 'PR',
    officeId: null,
    name: 'Default',
    isActive: true,
    steps: [
      {
        id: randomUUID(),
        stepOrder: 1,
        kind: 'finance_check',
        roleId: randomUUID(),
        minAmount: null,
        maxAmount: null,
      },
      {
        id: randomUUID(),
        stepOrder: 2,
        kind: 'final_approval',
        roleId: randomUUID(),
        minAmount: null,
        maxAmount: null,
      },
    ],
    ...overrides,
  };
}
