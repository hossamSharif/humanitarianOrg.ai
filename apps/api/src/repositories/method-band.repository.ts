// Procurement method bands (research D4): the tenant set (procurement_method_band) and the
// optional per-grant sets (grant_procurement_rule), each replaced as a whole. Migration 0015
// checks every set at commit. Also the PR line facts method resolution needs.
import type { MethodBand, ProcurementMethod } from '@ngo/shared';
import type { TxSql } from '../db/tx';

interface BandRow {
  method: ProcurementMethod;
  min_amount: string | null;
  max_amount: string | null;
  min_quotations: number;
}

const toBand = (r: BandRow): MethodBand => ({
  method: r.method,
  minAmount: r.min_amount,
  maxAmount: r.max_amount,
  minQuotations: r.min_quotations,
});

/** A PR line as method resolution sees it, with its PR's locked rates. */
export interface MethodPrLine {
  id: string;
  prId: string;
  prStatus: string;
  grantId: string | null;
  officeId: string | null;
  lineTotal: string;
  rateToBase: string | null;
  doaRateToBase: string | null;
}

export class MethodBandRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async listTenant(): Promise<MethodBand[]> {
    const rows = await this.sql<BandRow[]>`
      select method, min_amount::text, max_amount::text, min_quotations
      from public.procurement_method_band
      where tenant_id = ${this.tenantId}
      order by coalesce(min_amount, 0)`;
    return rows.map(toBand);
  }

  async listGrant(grantId: string): Promise<MethodBand[]> {
    const rows = await this.sql<BandRow[]>`
      select method, min_amount::text, max_amount::text, min_quotations
      from public.grant_procurement_rule
      where tenant_id = ${this.tenantId} and grant_id = ${grantId}
      order by coalesce(min_amount, 0)`;
    return rows.map(toBand);
  }

  async replaceTenant(bands: readonly MethodBand[]): Promise<void> {
    const sql = this.sql;
    await sql`delete from public.procurement_method_band where tenant_id = ${this.tenantId}`;
    if (bands.length === 0) return;
    await sql`
      insert into public.procurement_method_band ${sql(
        bands.map((b) => ({
          tenant_id: this.tenantId,
          method: b.method,
          min_amount: b.minAmount,
          max_amount: b.maxAmount,
          min_quotations: b.minQuotations,
        }))
      )}`;
  }

  async replaceGrant(grantId: string, bands: readonly MethodBand[]): Promise<void> {
    const sql = this.sql;
    await sql`
      delete from public.grant_procurement_rule
      where tenant_id = ${this.tenantId} and grant_id = ${grantId}`;
    if (bands.length === 0) return;
    await sql`
      insert into public.grant_procurement_rule ${sql(
        bands.map((b) => ({
          tenant_id: this.tenantId,
          grant_id: grantId,
          method: b.method,
          min_amount: b.minAmount,
          max_amount: b.maxAmount,
          min_quotations: b.minQuotations,
        }))
      )}`;
  }

  async grantExists(grantId: string): Promise<boolean> {
    const [row] = await this.sql<{ id: string }[]>`
      select id from public."grant" where tenant_id = ${this.tenantId} and id = ${grantId}`;
    return row !== undefined;
  }

  async doaReferenceCurrency(): Promise<string> {
    const [row] = await this.sql<{ currency: string }[]>`
      select doa_reference_currency as currency from public.tenant where id = ${this.tenantId}`;
    return row?.currency ?? 'USD';
  }

  async prLines(lineIds: readonly string[]): Promise<MethodPrLine[]> {
    const sql = this.sql;
    const rows = await sql<
      {
        id: string;
        pr_id: string;
        pr_status: string;
        grant_id: string | null;
        office_id: string | null;
        line_total: string;
        rate_to_base: string | null;
        doa_rate_to_base: string | null;
      }[]
    >`
      select l.id, p.id as pr_id, p.status as pr_status, p.grant_id,
             p.requesting_office_id as office_id, l.line_total::text,
             l.rate_to_base::text, p.doa_rate_to_base::text
      from public.pr_line l
      join public.purchase_requisition p on p.id = l.pr_id
      where l.tenant_id = ${this.tenantId} and l.id = any (${sql.array([...lineIds])}::uuid[])`;
    return rows.map((r) => ({
      id: r.id,
      prId: r.pr_id,
      prStatus: r.pr_status,
      grantId: r.grant_id,
      officeId: r.office_id,
      lineTotal: r.line_total,
      rateToBase: r.rate_to_base,
      doaRateToBase: r.doa_rate_to_base,
    }));
  }
}
