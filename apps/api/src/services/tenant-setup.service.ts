// POST /tenants and the organization profile (US1, FR-001, data-model §8).
//
// createTenant runs as ONE transaction: app.bootstrap_tenant() writes the tenant and the
// creator's active org-wide membership, the transaction then switches its claims to the new
// tenant and seeds units, roles, numbering and the default approval rule under RLS. The active
// organization (app_metadata.tenant_id) is set only after that transaction committed.
import { randomUUID } from 'node:crypto';
import {
  SEEDED_ROLES,
  type CreatedTenant,
  type CreateTenantInput,
  type LogoUploadInput,
  type LogoUploadUrl,
  type NumberingConfigInput,
  type SeededRoleKey,
  type TenantProfile,
  type UpdateTenantInput,
} from '@ngo/shared';
import { adminAuth } from '../db/supabase';
import { withTenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import {
  SqlTenantSeedStore,
  type SeedApprovalRule,
  type SeedUnit,
  type TenantProfileRow,
  type TenantProfileStore,
  type TenantSeedStore,
} from '../repositories/tenant.repository';
import type { AuthInfo, RequestContext } from '../types/context';

export const DEFAULT_UNITS: readonly SeedUnit[] = [
  { code: 'PCS', nameAr: 'قطعة', nameEn: 'PCs' },
  { code: 'PAK', nameAr: 'عبوة', nameEn: 'PAK' },
  { code: 'PERSON', nameAr: 'شخص', nameEn: 'Person' },
  { code: 'DAY', nameAr: 'يوم', nameEn: 'Day' },
  { code: 'KG', nameAr: 'كيلوجرام', nameEn: 'Kg' },
  { code: 'LTR', nameAr: 'لتر', nameEn: 'Liter' },
  { code: 'BOX', nameAr: 'صندوق', nameEn: 'Box' },
  { code: 'SET', nameAr: 'طقم', nameEn: 'Set' },
  { code: 'MTR', nameAr: 'متر', nameEn: 'Meter' },
  { code: 'MONTH', nameAr: 'شهر', nameEn: 'Month' },
  { code: 'LS', nameAr: 'مبلغ مقطوع', nameEn: 'Lump sum' },
];

export const DEFAULT_NUMBERING: NumberingConfigInput & { docType: 'PR' } = {
  docType: 'PR',
  prefix: 'PR',
  includeOffice: true,
  includeYear: true,
  padding: 4,
  separator: '-',
};

export const DEFAULT_APPROVAL_RULE_NAME = 'Default PR approval';

/** Finance check → Finance Checker, then one open final-approval band (0–∞) → Approver. */
export function defaultApprovalRule(roleIds: Record<SeededRoleKey, string>): SeedApprovalRule {
  return {
    docType: 'PR',
    officeId: null,
    name: DEFAULT_APPROVAL_RULE_NAME,
    isActive: true,
    steps: [
      {
        stepOrder: 1,
        kind: 'finance_check',
        roleId: roleIds.finance_checker,
        minAmount: null,
        maxAmount: null,
      },
      {
        stepOrder: 2,
        kind: 'final_approval',
        roleId: roleIds.approver,
        minAmount: null,
        maxAmount: null,
      },
    ],
  };
}

export interface TenantSetupDeps {
  runSeed<T>(
    auth: AuthInfo,
    requestId: string,
    fn: (store: TenantSeedStore) => Promise<T>
  ): Promise<T>;
  setTenantClaim(userId: string, tenantId: string): Promise<void>;
}

export const defaultTenantSetupDeps: TenantSetupDeps = {
  runSeed: (auth, requestId, fn) =>
    withTenantTx({ claims: auth.claims, requestId }, ({ sql }) =>
      fn(new SqlTenantSeedStore(sql, auth.claims))
    ),
  async setTenantClaim(userId, tenantId) {
    const { error } = await adminAuth().updateUserById(userId, {
      app_metadata: { tenant_id: tenantId },
    });
    if (error) {
      throw new AppError('INTERNAL_ERROR', `Could not set active organization: ${error.message}`);
    }
  },
};

export class TenantSetupService {
  constructor(private readonly deps: TenantSetupDeps = defaultTenantSetupDeps) {}

  async createTenant(
    auth: AuthInfo,
    requestId: string,
    input: CreateTenantInput
  ): Promise<CreatedTenant> {
    const created = await this.deps.runSeed(auth, requestId, async (store) => {
      const { tenantId, membershipId } = await store.bootstrap(input);
      await store.enterTenant(tenantId);

      await store.insertUnits([...DEFAULT_UNITS]);
      const roleIds = await store.insertRoles(
        Object.values(SEEDED_ROLES).map((r) => ({
          key: r.key,
          nameAr: r.nameAr,
          nameEn: r.nameEn,
          permissions: r.permissions,
        }))
      );
      await store.insertNumberingConfig({ ...DEFAULT_NUMBERING });
      await store.insertApprovalRule(defaultApprovalRule(roleIds));
      await store.insertUserRoles(membershipId, [roleIds.org_admin]);
      return { tenantId, membershipId };
    });

    await this.deps.setTenantClaim(auth.userId, created.tenantId);
    return { ...created, sessionRefreshRequired: true };
  }
}

const LOGO_EXTENSIONS: Record<LogoUploadInput['mimeType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export class TenantProfileService {
  constructor(
    private readonly ctx: RequestContext,
    private readonly store: TenantProfileStore
  ) {}

  private async toResponse(row: TenantProfileRow): Promise<TenantProfile> {
    const [logoUrl, submitted] = await Promise.all([
      row.logoPath ? this.store.logoUrl(row.logoPath) : Promise.resolve(null),
      this.store.hasSubmittedPr(),
    ]);
    return { ...row, logoUrl, baseCurrencyEditable: !submitted };
  }

  async getProfile(): Promise<TenantProfile> {
    return this.toResponse(await this.store.get());
  }

  async updateProfile(input: UpdateTenantInput): Promise<TenantProfile> {
    const current = await this.store.get();

    if (
      input.baseCurrency !== undefined &&
      input.baseCurrency !== current.baseCurrency &&
      (await this.store.hasSubmittedPr())
    ) {
      throw new AppError(
        'INVALID_STATE',
        'The base currency cannot change once a purchase requisition has been submitted'
      );
    }

    if (input.logoPath !== undefined && input.logoPath !== null) {
      if (!this.isOwnLogoPath(input.logoPath)) {
        throw new AppError('VALIDATION_ERROR', 'Unknown logo path', [
          { field: 'logoPath', message: 'invalid_value' },
        ]);
      }
    }

    return this.toResponse(await this.store.save(input));
  }

  /** A fresh versioned path every time: earlier logos stay, print snapshots reference them. */
  async createLogoUploadUrl(input: LogoUploadInput): Promise<LogoUploadUrl> {
    const path = `${this.ctx.tenantId}/logo-${randomUUID()}.${LOGO_EXTENSIONS[input.mimeType]}`;
    const { signedUrl, token } = await this.store.createLogoUploadUrl(path);
    return { path, signedUrl, token };
  }

  private isOwnLogoPath(path: string): boolean {
    const pattern = new RegExp(
      `^${this.ctx.tenantId}/logo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(png|jpg|webp|svg)$`
    );
    return pattern.test(path);
  }
}
