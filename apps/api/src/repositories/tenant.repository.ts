// The organization row (profile, logo in Storage) and the seed transaction of POST /tenants.
import type { Tables } from '@ngo/database';
import type { CreateTenantInput, NumberingConfigInput, SeededRoleKey, StepKind } from '@ngo/shared';
import type { UserClient } from '../db/supabase';
import { withTenantTx, type TxSql } from '../db/tx';
import { AppError } from '../middleware/error';
import type { RequestContext } from '../types/context';
import { BaseRepository } from './base.repository';

export const ORG_ASSETS_BUCKET = 'org-assets';
const LOGO_URL_TTL_SECONDS = 300;

export interface TenantProfileRow {
  id: string;
  nameAr: string;
  nameEn: string;
  logoPath: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  baseCurrency: string;
  doaReferenceCurrency: string;
  fiscalYearStartMonth: number;
  timezone: string;
  maxBackdateDays: number;
}

export interface TenantProfileStore {
  get(): Promise<TenantProfileRow>;
  save(values: Partial<Omit<TenantProfileRow, 'id'>>): Promise<TenantProfileRow>;
  hasSubmittedPr(): Promise<boolean>;
  createLogoUploadUrl(path: string): Promise<{ signedUrl: string; token: string }>;
  logoUrl(path: string): Promise<string | null>;
}

function toProfile(row: Tables<'tenant'>): TenantProfileRow {
  return {
    id: row.id,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    logoPath: row.logo_path,
    address: row.address,
    phone: row.phone,
    email: row.email,
    website: row.website,
    baseCurrency: row.base_currency,
    doaReferenceCurrency: row.doa_reference_currency,
    fiscalYearStartMonth: row.fiscal_year_start_month,
    timezone: row.timezone,
    maxBackdateDays: row.max_backdate_days,
  };
}

export class TenantRepository
  extends BaseRepository<Tables<'tenant'>>
  implements TenantProfileStore
{
  constructor(ctx: RequestContext, db?: UserClient) {
    super(ctx, 'tenant', db);
  }

  async get(): Promise<TenantProfileRow> {
    const { data, error } = await this.query().select('*').eq('id', this.ctx.tenantId).single();
    if (error || !data) throw new AppError('NOT_FOUND', 'tenant not found');
    return toProfile(data as Tables<'tenant'>);
  }

  async save(values: Partial<Omit<TenantProfileRow, 'id'>>): Promise<TenantProfileRow> {
    await this.update(this.ctx.tenantId, values);
    return this.get();
  }

  async hasSubmittedPr(): Promise<boolean> {
    return withTenantTx(this.ctx, async ({ sql }) => {
      const [row] = await sql<{ used: boolean }[]>`select app.tenant_has_submitted_pr() as used`;
      return row?.used ?? false;
    });
  }

  async createLogoUploadUrl(path: string): Promise<{ signedUrl: string; token: string }> {
    const { data, error } = await this.db.storage
      .from(ORG_ASSETS_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) {
      throw new AppError('INTERNAL_ERROR', `Could not create upload URL: ${error?.message}`);
    }
    return { signedUrl: data.signedUrl, token: data.token };
  }

  async logoUrl(path: string): Promise<string | null> {
    const { data } = await this.db.storage
      .from(ORG_ASSETS_BUCKET)
      .createSignedUrl(path, LOGO_URL_TTL_SECONDS);
    return data?.signedUrl ?? null;
  }
}

// ---------------------------------------------------------------------------------------------
// Seed transaction (data-model §8)
// ---------------------------------------------------------------------------------------------

export interface SeedUnit {
  code: string;
  nameAr: string;
  nameEn: string;
}

export interface SeedRole {
  key: SeededRoleKey;
  nameAr: string;
  nameEn: string;
  permissions: readonly string[];
}

export interface SeedApprovalRule {
  docType: 'PR';
  officeId: null;
  name: string;
  isActive: boolean;
  steps: {
    stepOrder: number;
    kind: StepKind;
    roleId: string;
    minAmount: string | null;
    maxAmount: string | null;
  }[];
}

/** Writes of one POST /tenants transaction; everything after enterTenant() runs under RLS. */
export interface TenantSeedStore {
  bootstrap(input: CreateTenantInput): Promise<{ tenantId: string; membershipId: string }>;
  enterTenant(tenantId: string): Promise<void>;
  insertUnits(units: SeedUnit[]): Promise<void>;
  /** roles and their role_permission rows; returns role ids by key */
  insertRoles(roles: SeedRole[]): Promise<Record<SeededRoleKey, string>>;
  insertNumberingConfig(config: NumberingConfigInput & { docType: 'PR' }): Promise<void>;
  insertApprovalRule(rule: SeedApprovalRule): Promise<string>;
  insertUserRoles(membershipId: string, roleIds: string[]): Promise<void>;
}

export class SqlTenantSeedStore implements TenantSeedStore {
  private tenantId: string | null = null;

  constructor(
    private readonly sql: TxSql,
    private readonly claims: Record<string, unknown>
  ) {}

  private get tenant(): string {
    if (!this.tenantId) throw new Error('enterTenant() must run before seeding');
    return this.tenantId;
  }

  async bootstrap(input: CreateTenantInput): Promise<{ tenantId: string; membershipId: string }> {
    const [row] = await this.sql<{ result: { tenantId: string; membershipId: string } }[]>`
      select app.bootstrap_tenant(
        ${input.nameAr}::text, ${input.nameEn}::text, ${input.address ?? null}::text,
        ${input.phone ?? null}::text, ${input.email ?? null}::text, ${input.website ?? null}::text,
        ${input.baseCurrency}::char(3), ${input.doaReferenceCurrency}::char(3),
        ${input.fiscalYearStartMonth}::smallint, ${input.timezone}::text,
        ${input.maxBackdateDays}::smallint, ${input.adminFullNameAr ?? null}::text,
        ${input.adminFullNameEn ?? null}::text, ${input.adminPositionTitle ?? null}::text
      ) as result`;
    if (!row) throw new AppError('INTERNAL_ERROR', 'Organization bootstrap returned nothing');
    return row.result;
  }

  async enterTenant(tenantId: string): Promise<void> {
    const meta = (this.claims.app_metadata as Record<string, unknown> | undefined) ?? {};
    const claims = { ...this.claims, app_metadata: { ...meta, tenant_id: tenantId } };
    await this.sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    this.tenantId = tenantId;
  }

  async insertUnits(units: SeedUnit[]): Promise<void> {
    const tenantId = this.tenant;
    await this.sql`
      insert into public.unit_of_measure ${this.sql(
        units.map((u) => ({
          tenant_id: tenantId,
          code: u.code,
          name_ar: u.nameAr,
          name_en: u.nameEn,
        }))
      )}`;
  }

  async insertRoles(roles: SeedRole[]): Promise<Record<SeededRoleKey, string>> {
    const tenantId = this.tenant;
    const rows = await this.sql<{ id: string; key: SeededRoleKey }[]>`
      insert into public.role ${this.sql(
        roles.map((r) => ({
          tenant_id: tenantId,
          key: r.key,
          name_ar: r.nameAr,
          name_en: r.nameEn,
          is_system: true,
        }))
      )}
      returning id, key`;
    const ids = Object.fromEntries(rows.map((r) => [r.key, r.id])) as Record<SeededRoleKey, string>;
    await this.sql`
      insert into public.role_permission ${this.sql(
        roles.flatMap((r) =>
          r.permissions.map((code) => ({
            role_id: ids[r.key],
            permission_code: code,
            tenant_id: tenantId,
          }))
        )
      )}`;
    return ids;
  }

  async insertNumberingConfig(config: NumberingConfigInput & { docType: 'PR' }): Promise<void> {
    await this.sql`
      insert into public.numbering_config
        (tenant_id, doc_type, prefix, include_office, include_year, padding, separator)
      values (${this.tenant}, ${config.docType}, ${config.prefix}, ${config.includeOffice},
              ${config.includeYear}, ${config.padding}, ${config.separator})`;
  }

  async insertApprovalRule(rule: SeedApprovalRule): Promise<string> {
    const tenantId = this.tenant;
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.approval_rule (tenant_id, doc_type, office_id, name, is_active)
      values (${tenantId}, ${rule.docType}, ${rule.officeId}, ${rule.name}, ${rule.isActive})
      returning id`;
    const ruleId = row!.id;
    await this.sql`
      insert into public.approval_rule_step ${this.sql(
        rule.steps.map((s) => ({
          tenant_id: tenantId,
          rule_id: ruleId,
          step_order: s.stepOrder,
          kind: s.kind,
          role_id: s.roleId,
          min_amount: s.minAmount,
          max_amount: s.maxAmount,
        }))
      )}`;
    return ruleId;
  }

  async insertUserRoles(membershipId: string, roleIds: string[]): Promise<void> {
    const tenantId = this.tenant;
    await this.sql`
      insert into public.user_role ${this.sql(
        roleIds.map((roleId) => ({
          tenant_id: tenantId,
          membership_id: membershipId,
          role_id: roleId,
        }))
      )}`;
  }
}
