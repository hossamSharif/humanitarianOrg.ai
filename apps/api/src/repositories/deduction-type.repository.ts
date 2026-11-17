// deduction_type: withholding and similar deductions with their liability payable account
// (002 data-model §2). Runs inside withTenantTx; master data, never deleted.
import type {
  CreateDeductionTypeInput,
  DeductionAppliesTo,
  DeductionType,
  UpdateDeductionTypeInput,
} from '@ngo/shared';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

interface DeductionRow {
  id: string;
  name_ar: string;
  name_en: string;
  rate_pct: string;
  applies_to: DeductionAppliesTo;
  payable_account_id: string;
  payable_account_code: string;
  is_active: boolean;
  version: number;
}

const toDeduction = (r: DeductionRow): DeductionType => ({
  id: r.id,
  nameAr: r.name_ar,
  nameEn: r.name_en,
  ratePct: r.rate_pct,
  appliesTo: r.applies_to,
  payableAccountId: r.payable_account_id,
  payableAccountCode: r.payable_account_code,
  isActive: r.is_active,
  version: r.version,
});

export class DeductionTypeRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  private select(id?: string) {
    return this.sql<DeductionRow[]>`
      select d.id, d.name_ar, d.name_en, d.rate_pct::text, d.applies_to, d.payable_account_id,
             g.code as payable_account_code, d.is_active, d.version
      from public.deduction_type d
      join public.gl_account g on g.id = d.payable_account_id
      where d.tenant_id = ${this.tenantId} ${id ? this.sql`and d.id = ${id}` : this.sql``}
      order by d.name_en`;
  }

  async list(): Promise<DeductionType[]> {
    return (await this.select()).map(toDeduction);
  }

  async getById(id: string): Promise<DeductionType> {
    const [row] = await this.select(id);
    if (!row) throw new AppError('NOT_FOUND', 'Deduction type not found');
    return toDeduction(row);
  }

  /** A posting liability account of the tenant (the payable side of a deduction). */
  async isPayableAccount(accountId: string): Promise<boolean> {
    const [row] = await this.sql<{ id: string }[]>`
      select id from public.gl_account
      where tenant_id = ${this.tenantId} and id = ${accountId}
        and is_posting and type = 'liability'`;
    return row !== undefined;
  }

  async insert(input: CreateDeductionTypeInput): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.deduction_type
        (tenant_id, name_ar, name_en, rate_pct, applies_to, payable_account_id, is_active)
      values (${this.tenantId}, ${input.nameAr}, ${input.nameEn}, ${input.ratePct},
              ${input.appliesTo}, ${input.payableAccountId}, ${input.isActive})
      returning id`;
    return row!.id;
  }

  /** 409 VERSION_CONFLICT when `expectedVersion` is stale. */
  async update(id: string, input: UpdateDeductionTypeInput): Promise<void> {
    const current = await this.getById(id);
    if (current.version !== input.expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
    const rows = await this.sql`
      update public.deduction_type
      set name_ar = ${input.nameAr ?? current.nameAr},
          name_en = ${input.nameEn ?? current.nameEn},
          rate_pct = ${input.ratePct ?? current.ratePct},
          applies_to = ${input.appliesTo ?? current.appliesTo},
          payable_account_id = ${input.payableAccountId ?? current.payableAccountId},
          is_active = ${input.isActive ?? current.isActive}
      where tenant_id = ${this.tenantId} and id = ${id} and version = ${input.expectedVersion}
      returning id`;
    if (rows.length === 0) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
  }
}
