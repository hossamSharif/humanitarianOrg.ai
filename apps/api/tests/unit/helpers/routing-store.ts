// In-memory ApprovalRoutingStore for US3 unit tests: rules, members with roles/offices, role
// permission sets and PR signatures, all held in plain arrays the test arranges.
import { randomUUID } from 'node:crypto';
import { SEEDED_ROLES, type Permission, type SeededRoleKey } from '@ngo/shared';
import type {
  ApprovalRoutingStore,
  Candidate,
  RoleName,
  RuleLike,
  Signature,
} from '../../../src/services/approval-routing.service';
import { MAD_OFFICE_ID, type RuleFixture } from './builders';

export interface TestRole {
  id: string;
  nameAr: string;
  nameEn: string;
  permissions: Permission[];
}

export function buildRole(key: SeededRoleKey, overrides: Partial<TestRole> = {}): TestRole {
  const seeded = SEEDED_ROLES[key];
  return {
    id: randomUUID(),
    nameAr: seeded.nameAr,
    nameEn: seeded.nameEn,
    permissions: [...seeded.permissions],
    ...overrides,
  };
}

export function buildCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    userId: randomUUID(),
    membershipId: randomUUID(),
    status: 'active',
    roleIds: [],
    orgWideAccess: false,
    officeIds: [MAD_OFFICE_ID],
    ...overrides,
  };
}

/** RuleFixture (builders.ts) → the shape the routing service reads. */
export function toRuleLike(rule: RuleFixture): RuleLike {
  return {
    id: rule.id,
    name: rule.name,
    officeId: rule.officeId,
    isActive: rule.isActive,
    steps: rule.steps.map((s) => ({ ...s })),
  };
}

export class InMemoryRoutingStore implements ApprovalRoutingStore {
  rules: RuleLike[] = [];
  roles: TestRole[] = [];
  members: Candidate[] = [];
  signatures = new Map<string, Signature[]>();

  async listRules(): Promise<RuleLike[]> {
    return structuredClone(this.rules);
  }

  async roleHolders(roleId: string): Promise<Candidate[]> {
    return this.members.filter((m) => m.roleIds.includes(roleId)).map((m) => structuredClone(m));
  }

  async rolePermissions(roleIds: readonly string[]): Promise<Map<string, Permission[]>> {
    return new Map(
      this.roles.filter((r) => roleIds.includes(r.id)).map((r) => [r.id, [...r.permissions]])
    );
  }

  async roleNames(roleIds: readonly string[]): Promise<Map<string, RoleName>> {
    return new Map(
      this.roles
        .filter((r) => roleIds.includes(r.id))
        .map((r) => [r.id, { nameAr: r.nameAr, nameEn: r.nameEn }])
    );
  }

  async prSignatures(prId: string): Promise<Signature[]> {
    return [...(this.signatures.get(prId) ?? [])];
  }
}
