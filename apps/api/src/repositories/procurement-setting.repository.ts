// procurement_setting: one row per tenant (002 data-model §2), seeded by
// app.seed_procurement_defaults. Runs inside withTenantTx.
import type { ProcurementSettings, ProcurementSettingsInput } from '@ngo/shared';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

interface SettingRow {
  invoice_price_tolerance_pct: string;
  invoice_qty_tolerance_pct: string;
  grn_over_delivery_tolerance_pct: string;
  committee_min_size: number;
  revetting_months: number;
  guarantee_warning_days: number;
  advance_overdue_days: number;
  require_po_acknowledgement: boolean;
  splitting_window_days: number;
  version: number;
}

function toSettings(r: SettingRow): ProcurementSettings {
  return {
    invoicePriceTolerancePct: r.invoice_price_tolerance_pct,
    invoiceQtyTolerancePct: r.invoice_qty_tolerance_pct,
    grnOverDeliveryTolerancePct: r.grn_over_delivery_tolerance_pct,
    committeeMinSize: r.committee_min_size,
    revettingMonths: r.revetting_months,
    guaranteeWarningDays: r.guarantee_warning_days,
    advanceOverdueDays: r.advance_overdue_days,
    requirePoAcknowledgement: r.require_po_acknowledgement,
    splittingWindowDays: r.splitting_window_days,
    version: r.version,
  };
}

export class ProcurementSettingRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async get(): Promise<ProcurementSettings> {
    const [row] = await this.sql<SettingRow[]>`
      select invoice_price_tolerance_pct::text, invoice_qty_tolerance_pct::text,
             grn_over_delivery_tolerance_pct::text, committee_min_size, revetting_months,
             guarantee_warning_days, advance_overdue_days, require_po_acknowledgement,
             splitting_window_days, version
      from public.procurement_setting where tenant_id = ${this.tenantId}`;
    if (!row) throw new AppError('NOT_FOUND', 'Procurement settings not found');
    return toSettings(row);
  }

  /** 409 VERSION_CONFLICT when `expectedVersion` is stale. */
  async update(input: ProcurementSettingsInput): Promise<ProcurementSettings> {
    const rows = await this.sql<{ version: number }[]>`
      update public.procurement_setting
      set invoice_price_tolerance_pct = ${input.invoicePriceTolerancePct},
          invoice_qty_tolerance_pct = ${input.invoiceQtyTolerancePct},
          grn_over_delivery_tolerance_pct = ${input.grnOverDeliveryTolerancePct},
          committee_min_size = ${input.committeeMinSize},
          revetting_months = ${input.revettingMonths},
          guarantee_warning_days = ${input.guaranteeWarningDays},
          advance_overdue_days = ${input.advanceOverdueDays},
          require_po_acknowledgement = ${input.requirePoAcknowledgement},
          splitting_window_days = ${input.splittingWindowDays}
      where tenant_id = ${this.tenantId} and version = ${input.expectedVersion}
      returning version`;
    if (rows.length === 0) {
      await this.get();
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
    return this.get();
  }
}
