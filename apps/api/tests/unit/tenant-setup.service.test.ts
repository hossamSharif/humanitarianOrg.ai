// T051 — creating an organization seeds its defaults (US1-3, data-model §8) and the profile
// rules of FR-001 (base currency fixed after the first submitted PR, versioned logos).
import {
  ALL_PERMISSIONS,
  createTenantBody,
  SEEDED_ROLES,
  STEP_KIND_PERMISSION,
  type SeededRoleKey,
} from '@ngo/shared';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPROVAL_RULE_NAME,
  DEFAULT_UNITS,
  TenantProfileService,
  TenantSetupService,
} from '../../src/services/tenant-setup.service';
import type { AuthInfo } from '../../src/types/context';
import { buildContext, TENANT_ID } from './helpers/builders';
import {
  buildTenantRow,
  InMemoryTenantProfileStore,
  inMemorySetupDeps,
} from './helpers/in-memory-tenant-store';

const USER_ID = '22222222-2222-4222-8222-222222222222';

const auth: AuthInfo = {
  userId: USER_ID,
  email: 'admin@rtha.example.org',
  claims: { sub: USER_ID, role: 'authenticated', app_metadata: {} },
  accessToken: 'token',
};

const input = createTenantBody.parse({ nameAr: 'منظمة رتها', nameEn: 'RTHA' });

async function createTenant() {
  const setup = inMemorySetupDeps();
  const result = await new TenantSetupService(setup.deps).createTenant(auth, 'req-1', input);
  return { ...setup, result, seeded: setup.store.tenant };
}

describe('TenantSetupService.createTenant', () => {
  it('applies the profile defaults (SDG, USD, January, Africa/Khartoum, 30 days)', () => {
    expect(input).toMatchObject({
      baseCurrency: 'SDG',
      doaReferenceCurrency: 'USD',
      fiscalYearStartMonth: 1,
      timezone: 'Africa/Khartoum',
      maxBackdateDays: 30,
    });
  });

  it('bootstraps the tenant and switches the seed transaction into it before seeding', async () => {
    const { seeded, result } = await createTenant();
    expect(seeded.input).toEqual(input);
    expect(seeded.enteredTenantId).toBe(seeded.tenantId);
    expect(result).toEqual({
      tenantId: seeded.tenantId,
      membershipId: seeded.membershipId,
      sessionRefreshRequired: true,
    });
  });

  it('seeds the 11 default units of measure', async () => {
    const { seeded } = await createTenant();
    expect(seeded.units.map((u) => u.nameEn)).toEqual([
      'PCs',
      'PAK',
      'Person',
      'Day',
      'Kg',
      'Liter',
      'Box',
      'Set',
      'Meter',
      'Month',
      'Lump sum',
    ]);
    expect(seeded.units).toEqual(DEFAULT_UNITS);
    expect(new Set(seeded.units.map((u) => u.code)).size).toBe(11);
    for (const unit of seeded.units) {
      expect(unit.code).toMatch(/^[A-Z0-9_-]{1,20}$/);
      expect(unit.nameAr.length).toBeGreaterThan(0);
    }
  });

  it('seeds the 5 system roles with exactly the permissions of SEEDED_ROLES', async () => {
    const { seeded } = await createTenant();
    expect(seeded.roles.map((r) => r.key).sort()).toEqual(
      ['approver', 'finance_checker', 'org_admin', 'requester', 'viewer'].sort()
    );
    for (const role of seeded.roles) {
      const expected = SEEDED_ROLES[role.key];
      expect(role.nameAr).toBe(expected.nameAr);
      expect(role.nameEn).toBe(expected.nameEn);
      expect([...role.permissions].sort()).toEqual([...expected.permissions].sort());
    }
    const admin = seeded.roles.find((r) => r.key === 'org_admin')!;
    expect(admin.permissions).toHaveLength(ALL_PERMISSIONS.length - 2);
    expect(admin.permissions).not.toContain('pr:approve');
    expect(admin.permissions).not.toContain('pr:finance_check');
  });

  it('seeds PR numbering: PR, office, year, padding 4, "-"', async () => {
    const { seeded } = await createTenant();
    expect(seeded.numbering).toEqual([
      {
        docType: 'PR',
        prefix: 'PR',
        includeOffice: true,
        includeYear: true,
        padding: 4,
        separator: '-',
      },
    ]);
  });

  it('seeds the org-wide default rule: finance check → Finance Checker, final approval 0–∞ → Approver', async () => {
    const { seeded } = await createTenant();
    expect(seeded.rules).toHaveLength(1);
    const rule = seeded.rules[0]!;
    const roleId = (key: SeededRoleKey) => seeded.roles.find((r) => r.key === key)!.id;
    expect(rule).toMatchObject({
      docType: 'PR',
      officeId: null,
      name: DEFAULT_APPROVAL_RULE_NAME,
      isActive: true,
    });
    expect(rule.steps).toEqual([
      {
        stepOrder: 1,
        kind: 'finance_check',
        roleId: roleId('finance_checker'),
        minAmount: null,
        maxAmount: null,
      },
      {
        stepOrder: 2,
        kind: 'final_approval',
        roleId: roleId('approver'),
        minAmount: null,
        maxAmount: null,
      },
    ]);
    // each step's role grants the permission its kind needs, so the rule is resolvable
    for (const step of rule.steps) {
      const role = seeded.roles.find((r) => r.id === step.roleId)!;
      expect(role.permissions).toContain(STEP_KIND_PERMISSION[step.kind]);
    }
  });

  it('gives the creator the Organization Admin role (the membership is org-wide and active)', async () => {
    const { seeded } = await createTenant();
    const adminRoleId = seeded.roles.find((r) => r.key === 'org_admin')!.id;
    expect(seeded.userRoles).toEqual([{ membershipId: seeded.membershipId, roleId: adminRoleId }]);
  });

  it('sets app_metadata.tenant_id only after the seed transaction committed', async () => {
    const setup = await createTenant();
    expect(setup.committed).toBe(true);
    expect(setup.claimsSet).toEqual([{ userId: USER_ID, tenantId: setup.seeded.tenantId }]);
  });

  it('does not touch app_metadata when seeding fails', async () => {
    const setup = inMemorySetupDeps();
    setup.store.insertApprovalRule = async () => {
      throw new Error('boom');
    };
    await expect(
      new TenantSetupService(setup.deps).createTenant(auth, 'req-1', input)
    ).rejects.toThrow('boom');
    expect(setup.claimsSet).toEqual([]);
  });
});

describe('TenantProfileService', () => {
  const ctx = buildContext({ permissions: new Set(['settings:manage']) });

  it('returns the profile with a signed logo URL and baseCurrencyEditable', async () => {
    const store = new InMemoryTenantProfileStore(
      buildTenantRow({ logoPath: `${TENANT_ID}/logo-abc` })
    );
    const profile = await new TenantProfileService(ctx, store).getProfile();
    expect(profile).toMatchObject({
      nameEn: 'RTHA',
      logoUrl: `https://storage.test/sign/${TENANT_ID}/logo-abc`,
      baseCurrencyEditable: true,
    });
  });

  it('updates profile fields', async () => {
    const store = new InMemoryTenantProfileStore(buildTenantRow());
    const updated = await new TenantProfileService(ctx, store).updateProfile({
      nameEn: 'RTHA Sudan',
      maxBackdateDays: 10,
      address: null,
    });
    expect(updated).toMatchObject({ nameEn: 'RTHA Sudan', maxBackdateDays: 10, address: null });
  });

  it('allows changing the base currency until a PR has been submitted', async () => {
    const store = new InMemoryTenantProfileStore(buildTenantRow());
    const service = new TenantProfileService(ctx, store);
    await expect(service.updateProfile({ baseCurrency: 'USD' })).resolves.toMatchObject({
      baseCurrency: 'USD',
    });

    store.submittedPr = true;
    await expect(service.updateProfile({ baseCurrency: 'SDG' })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    // re-sending the same value is not a change
    await expect(
      service.updateProfile({ baseCurrency: 'USD', nameEn: 'X' })
    ).resolves.toMatchObject({ nameEn: 'X' });
    expect((await service.getProfile()).baseCurrencyEditable).toBe(false);
  });

  it('issues a new versioned logo path each time, never reusing one', async () => {
    const store = new InMemoryTenantProfileStore(buildTenantRow());
    const service = new TenantProfileService(ctx, store);
    const a = await service.createLogoUploadUrl({ mimeType: 'image/png', sizeBytes: 1000 });
    const b = await service.createLogoUploadUrl({ mimeType: 'image/png', sizeBytes: 1000 });
    expect(a.path).toMatch(new RegExp(`^${TENANT_ID}/logo-[0-9a-f-]{36}\\.png$`));
    expect(b.path).not.toBe(a.path);
    expect(store.uploadPaths).toEqual([a.path, b.path]);
  });

  it('accepts only logo paths of its own tenant', async () => {
    const store = new InMemoryTenantProfileStore(buildTenantRow());
    const service = new TenantProfileService(ctx, store);
    await expect(
      service.updateProfile({ logoPath: 'other-tenant/logo-1.png' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.updateProfile({ logoPath: `${TENANT_ID}/../x/logo-1.png` })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const { path } = await service.createLogoUploadUrl({ mimeType: 'image/jpeg', sizeBytes: 10 });
    await expect(service.updateProfile({ logoPath: path })).resolves.toMatchObject({
      logoPath: path,
    });
  });
});
