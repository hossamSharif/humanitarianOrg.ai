// In-memory stand-ins for the US1 setup stores: the tenant seed transaction, the organization
// profile, and numbering. They record what the services wrote so tests can assert on it.
import { randomUUID } from 'node:crypto';
import type { CreateTenantInput, NumberingConfigInput, SeededRoleKey } from '@ngo/shared';
import { AppError } from '../../../src/middleware/error';
import type {
  NumberingStore,
  NumberingTxStore,
  OfficeRef,
} from '../../../src/repositories/numbering.repository';
import type {
  SeedApprovalRule,
  SeedRole,
  SeedUnit,
  TenantProfileRow,
  TenantProfileStore,
  TenantSeedStore,
} from '../../../src/repositories/tenant.repository';
import type { TenantSetupDeps } from '../../../src/services/tenant-setup.service';
import type { AuthInfo } from '../../../src/types/context';

export interface SeededTenant {
  tenantId: string;
  membershipId: string;
  input: CreateTenantInput;
  enteredTenantId: string | null;
  units: SeedUnit[];
  roles: (SeedRole & { id: string })[];
  numbering: (NumberingConfigInput & { docType: 'PR' })[];
  rules: (SeedApprovalRule & { id: string })[];
  userRoles: { membershipId: string; roleId: string }[];
}

/** One seed transaction; `committed` is set only when the callback finished without throwing. */
export class InMemoryTenantSeedStore implements TenantSeedStore {
  readonly tenant: SeededTenant = {
    tenantId: randomUUID(),
    membershipId: randomUUID(),
    input: undefined as unknown as CreateTenantInput,
    enteredTenantId: null,
    units: [],
    roles: [],
    numbering: [],
    rules: [],
    userRoles: [],
  };

  async bootstrap(input: CreateTenantInput) {
    this.tenant.input = input;
    return { tenantId: this.tenant.tenantId, membershipId: this.tenant.membershipId };
  }

  async enterTenant(tenantId: string) {
    this.tenant.enteredTenantId = tenantId;
  }

  private requireTenant() {
    if (this.tenant.enteredTenantId !== this.tenant.tenantId) {
      throw new Error('seed row written before enterTenant(): RLS would reject it');
    }
  }

  async insertUnits(units: SeedUnit[]) {
    this.requireTenant();
    this.tenant.units.push(...units);
  }

  async insertRoles(roles: SeedRole[]) {
    this.requireTenant();
    const ids = {} as Record<SeededRoleKey, string>;
    for (const role of roles) {
      const id = randomUUID();
      ids[role.key] = id;
      this.tenant.roles.push({ ...role, id });
    }
    return ids;
  }

  async insertNumberingConfig(config: NumberingConfigInput & { docType: 'PR' }) {
    this.requireTenant();
    this.tenant.numbering.push(config);
  }

  async insertApprovalRule(rule: SeedApprovalRule) {
    this.requireTenant();
    const id = randomUUID();
    this.tenant.rules.push({ ...rule, id });
    return id;
  }

  async insertUserRoles(membershipId: string, roleIds: string[]) {
    this.requireTenant();
    for (const roleId of roleIds) this.tenant.userRoles.push({ membershipId, roleId });
  }
}

export function inMemorySetupDeps(store = new InMemoryTenantSeedStore()) {
  const claimsSet: { userId: string; tenantId: string }[] = [];
  let committed = false;
  const deps: TenantSetupDeps = {
    async runSeed(_auth: AuthInfo, _requestId: string, fn) {
      const result = await fn(store);
      committed = true;
      return result;
    },
    async setTenantClaim(userId, tenantId) {
      claimsSet.push({ userId, tenantId });
    },
  };
  return {
    deps,
    store,
    claimsSet,
    get committed() {
      return committed;
    },
  };
}

export class InMemoryTenantProfileStore implements TenantProfileStore {
  submittedPr = false;
  readonly uploadPaths: string[] = [];

  constructor(public row: TenantProfileRow) {}

  async get() {
    return structuredClone(this.row);
  }

  async save(values: Partial<TenantProfileRow>) {
    this.row = { ...this.row, ...values };
    return structuredClone(this.row);
  }

  async hasSubmittedPr() {
    return this.submittedPr;
  }

  async createLogoUploadUrl(path: string) {
    this.uploadPaths.push(path);
    return { signedUrl: `https://storage.test/upload/${path}?token=t`, token: 't' };
  }

  async logoUrl(path: string) {
    return `https://storage.test/sign/${path}`;
  }
}

export function buildTenantRow(overrides: Partial<TenantProfileRow> = {}): TenantProfileRow {
  return {
    id: '00000000-0000-4000-8000-00000000a001',
    nameAr: 'منظمة رتها',
    nameEn: 'RTHA',
    logoPath: null,
    address: null,
    phone: null,
    email: null,
    website: null,
    baseCurrency: 'SDG',
    doaReferenceCurrency: 'USD',
    fiscalYearStartMonth: 1,
    timezone: 'Africa/Khartoum',
    maxBackdateDays: 30,
    ...overrides,
  };
}

interface OfficeFixture extends OfficeRef {
  isActive: boolean;
}

/** Numbering config, offices and document_sequence rows of one tenant. */
export class InMemoryNumberingStore implements NumberingStore, NumberingTxStore {
  config: NumberingConfigInput | null = {
    prefix: 'PR',
    includeOffice: true,
    includeYear: true,
    padding: 4,
    separator: '-',
  };
  readonly offices: OfficeFixture[] = [];
  /** `${officeId}:${year}` → last_value */
  readonly sequences = new Map<string, number>();
  timeZoneName = 'Africa/Khartoum';

  addOffice(code: string, isActive = true): string {
    const id = randomUUID();
    this.offices.push({ id, code, isActive });
    return id;
  }

  async getConfig() {
    if (!this.config) throw new AppError('NOT_FOUND', 'numbering_config not found');
    return { ...this.config };
  }

  async saveConfig(_docType: 'PR', input: NumberingConfigInput) {
    this.config = { ...input };
    return { ...input };
  }

  async office(officeId: string) {
    const office = this.offices.find((o) => o.id === officeId);
    if (!office) throw new AppError('NOT_FOUND', 'office not found');
    return { id: office.id, code: office.code };
  }

  async firstActiveOffice() {
    const office = [...this.offices]
      .filter((o) => o.isActive)
      .sort((a, b) => a.code.localeCompare(b.code))[0];
    return office ? { id: office.id, code: office.code } : null;
  }

  async lastValue(_docType: 'PR', officeId: string, year: number) {
    return this.sequences.get(`${officeId}:${year}`) ?? 0;
  }

  async timeZone() {
    return this.timeZoneName;
  }

  async nextValue(_docType: 'PR', officeId: string, year: number) {
    const next = (this.sequences.get(`${officeId}:${year}`) ?? 0) + 1;
    this.sequences.set(`${officeId}:${year}`, next);
    return next;
  }
}
