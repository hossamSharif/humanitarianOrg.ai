// purchase_order (⟨doc⟩ ⟨doa⟩, numbering PO / CON; data-model §5, research R23): one per awarded
// supplier of an approved analysis. Header reads and writes for the purchase-order service and
// the PO adapter; supplier, grant, office and currency are inherited by trigger and never
// written here after the insert. Office scope comes from RLS.
import type { ListResponse, PoKind, PurchaseOrderStatus, PurchaseOrderSummary } from '@ngo/shared';
import type postgres from 'postgres';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

export interface PurchaseOrderRecord extends PurchaseOrderSummary {
  version: number;
  officeId: string;
  createdBy: string;
  grantId: string;
  grantCode: string;
  grantCurrency: string;
  grantStatus: string;
  eventNumber: string | null;
  deliveryAddress: string | null;
  deliverySchedule: string | null;
  deliveryTerms: string | null;
  paymentTermsText: string | null;
  specialConditions: string | null;
  advancePct: string;
  retentionPct: string;
  retentionReleaseDate: string | null;
  isService: boolean;
  total: string;
  poVersion: number;
  submissionCycle: number;
  currentStepOrder: number | null;
  commitRateToBase: string | null;
  commitRateDate: string | null;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  acknowledgementAttachmentId: string | null;
  closeReason: string | null;
  closedAt: string | null;
  cancelReason: string | null;
  returnReason: string | null;
  rejectReason: string | null;
  scopeText: string | null;
  startDate: string | null;
  endDate: string | null;
  doaCurrency: string | null;
  doaAmount: string | null;
  supplierStatus: string;
  blacklistFlag: boolean;
}

interface Row {
  id: string;
  kind: PoKind;
  doc_type: 'PO' | 'CON';
  number: string | null;
  status: PurchaseOrderStatus;
  supplier_id: string;
  supplier_name_ar: string;
  supplier_name_en: string;
  supplier_status: string;
  bid_analysis_id: string | null;
  analysis_number: string | null;
  event_number: string | null;
  currency: string;
  total_with_amendments: string;
  total: string;
  po_date: string | null;
  created_at: Date;
  version: number;
  office_id: string;
  created_by: string;
  grant_id: string;
  grant_code: string;
  grant_currency: string;
  grant_status: string;
  delivery_address: string | null;
  delivery_schedule: string | null;
  delivery_terms: string | null;
  payment_terms_text: string | null;
  special_conditions: string | null;
  advance_pct: string;
  retention_pct: string;
  retention_release_date: string | null;
  is_service: boolean;
  po_version: number;
  submission_cycle: number;
  current_step_order: number | null;
  commit_rate_to_base: string | null;
  commit_rate_date: string | null;
  acknowledged_at: string | null;
  acknowledged_by_name: string | null;
  acknowledgement_attachment_id: string | null;
  close_reason: string | null;
  closed_at: Date | null;
  cancel_reason: string | null;
  return_reason: string | null;
  reject_reason: string | null;
  scope_text: string | null;
  start_date: string | null;
  end_date: string | null;
  doa_currency: string | null;
  doa_amount: string | null;
  total_count?: number;
}

const toSummary = (r: Row): PurchaseOrderSummary => ({
  id: r.id,
  kind: r.kind,
  docType: r.doc_type,
  number: r.number,
  status: r.status,
  supplierId: r.supplier_id,
  supplierNameAr: r.supplier_name_ar,
  supplierNameEn: r.supplier_name_en,
  bidAnalysisId: r.bid_analysis_id,
  analysisNumber: r.analysis_number,
  currency: r.currency,
  totalWithAmendments: r.total_with_amendments,
  poDate: r.po_date,
  createdAt: r.created_at.toISOString(),
});

function toRecord(r: Row): PurchaseOrderRecord {
  return {
    ...toSummary(r),
    version: r.version,
    officeId: r.office_id,
    createdBy: r.created_by,
    grantId: r.grant_id,
    grantCode: r.grant_code,
    grantCurrency: r.grant_currency,
    grantStatus: r.grant_status,
    eventNumber: r.event_number,
    deliveryAddress: r.delivery_address,
    deliverySchedule: r.delivery_schedule,
    deliveryTerms: r.delivery_terms,
    paymentTermsText: r.payment_terms_text,
    specialConditions: r.special_conditions,
    advancePct: r.advance_pct,
    retentionPct: r.retention_pct,
    retentionReleaseDate: r.retention_release_date,
    isService: r.is_service,
    total: r.total,
    poVersion: r.po_version,
    submissionCycle: r.submission_cycle,
    currentStepOrder: r.current_step_order,
    commitRateToBase: r.commit_rate_to_base,
    commitRateDate: r.commit_rate_date,
    acknowledgedAt: r.acknowledged_at,
    acknowledgedByName: r.acknowledged_by_name,
    acknowledgementAttachmentId: r.acknowledgement_attachment_id,
    closeReason: r.close_reason,
    closedAt: r.closed_at?.toISOString() ?? null,
    cancelReason: r.cancel_reason,
    returnReason: r.return_reason,
    rejectReason: r.reject_reason,
    scopeText: r.scope_text,
    startDate: r.start_date,
    endDate: r.end_date,
    doaCurrency: r.doa_currency,
    doaAmount: r.doa_amount,
    supplierStatus: r.supplier_status,
    blacklistFlag: r.supplier_status === 'blacklisted',
  };
}

/** The fields PATCH /pos/:id may write (snake_case column → value). */
export type PoPatchColumns = Partial<
  Record<
    | 'po_date'
    | 'delivery_address'
    | 'delivery_schedule'
    | 'delivery_terms'
    | 'payment_terms_text'
    | 'special_conditions'
    | 'advance_pct'
    | 'retention_pct'
    | 'retention_release_date'
    | 'is_service'
    | 'scope_text'
    | 'start_date'
    | 'end_date',
    string | boolean | null
  >
>;

/** Columns the PO adapter writes at submission (⟨doa⟩ locked, 001 R7). */
export interface PoSubmitValues {
  number: string;
  status: string;
  submissionCycle: number;
  currentStepOrder: number;
  submittedAt: string;
  doaCurrency: string;
  doaAmount: string;
  doaRateToBase: string;
  doaRateDate: string;
  doaRateSource: string;
  doaExchangeRateId: string | null;
}

/** The rate of the PO currency locked at approval, and the grant currency's (research D2). */
export interface PoCommitRate {
  rateToBase: string;
  rateDate: string;
  rateSource: string;
  exchangeRateId: string | null;
  grantRateToBase: string;
}

/** An awarded supplier of an analysis, with what decides its document kind. */
export interface AwardedSupplier {
  supplierId: string;
  currency: string;
  /** every awarded PR line comes from a services PR */
  allServices: boolean;
}

export class PurchaseOrderRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  private select(where: postgres.PendingQuery<postgres.Row[]>, tail = this.sql``) {
    return this.sql<Row[]>`
      select p.id, p.kind, p.doc_type, p.number, p.status, p.supplier_id,
             s.legal_name_ar as supplier_name_ar, s.legal_name_en as supplier_name_en,
             s.status as supplier_status, p.bid_analysis_id, b.number as analysis_number,
             e.number as event_number, p.currency::text, p.total_with_amendments::text,
             p.total::text, p.po_date::text, p.created_at, p.version, p.office_id, p.created_by,
             p.grant_id, g.code as grant_code, g.currency::text as grant_currency,
             g.status as grant_status, p.delivery_address, p.delivery_schedule, p.delivery_terms,
             p.payment_terms_text, p.special_conditions, p.advance_pct::text,
             p.retention_pct::text, p.retention_release_date::text, p.is_service, p.po_version,
             p.submission_cycle, p.current_step_order, p.commit_rate_to_base::text,
             p.commit_rate_date::text, p.acknowledged_at::text, p.acknowledged_by_name,
             p.acknowledgement_attachment_id, p.close_reason, p.closed_at, p.cancel_reason,
             p.return_reason, p.reject_reason, p.scope_text, p.start_date::text,
             p.end_date::text, p.doa_currency::text, p.doa_amount::text,
             count(*) over ()::int as total_count
      from public.purchase_order p
      join public.supplier s on s.id = p.supplier_id
      join public."grant" g on g.id = p.grant_id
      left join public.bid_analysis b on b.id = p.bid_analysis_id
      left join public.sourcing_event e on e.id = b.sourcing_event_id
      where p.tenant_id = ${this.tenantId} ${where}
      ${tail}`;
  }

  async list(filter: {
    page: number;
    pageSize: number;
    status?: PurchaseOrderStatus;
    kind?: PoKind;
    bidAnalysisId?: string;
    receivable?: boolean;
  }): Promise<ListResponse<PurchaseOrderSummary>> {
    const sql = this.sql;
    const { page, pageSize } = filter;
    const rows = await this.select(
      sql`${filter.status ? sql`and p.status = ${filter.status}` : sql``}
          ${filter.kind ? sql`and p.kind = ${filter.kind}` : sql``}
          ${filter.bidAnalysisId ? sql`and p.bid_analysis_id = ${filter.bidAnalysisId}` : sql``}
          ${
            filter.receivable
              ? sql`and p.status in ('approved', 'acknowledged', 'partially_received')
                    and not p.is_service and p.kind = 'po'`
              : sql``
          }`,
      sql`order by p.created_at desc, p.id limit ${pageSize} offset ${(page - 1) * pageSize}`
    );
    return { data: rows.map(toSummary), page, pageSize, total: rows[0]?.total_count ?? 0 };
  }

  async find(id: string, options: { lock?: boolean } = {}): Promise<PurchaseOrderRecord | null> {
    if (options.lock) {
      const [locked] = await this.sql<{ id: string }[]>`
        select id from public.purchase_order
        where tenant_id = ${this.tenantId} and id = ${id}
        for update`;
      if (!locked) return null;
    }
    const [row] = await this.select(this.sql`and p.id = ${id}`);
    return row ? toRecord(row) : null;
  }

  async get(id: string, options: { lock?: boolean } = {}): Promise<PurchaseOrderRecord> {
    const po = await this.find(id, options);
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found');
    return po;
  }

  /** Live (not cancelled) POs of an analysis, by supplier. */
  async liveForAnalysis(analysisId: string): Promise<{ id: string; supplierId: string }[]> {
    const rows = await this.sql<{ id: string; supplier_id: string }[]>`
      select id, supplier_id from public.purchase_order
      where tenant_id = ${this.tenantId} and bid_analysis_id = ${analysisId}
        and status <> 'cancelled'`;
    return rows.map((r) => ({ id: r.id, supplierId: r.supplier_id }));
  }

  /** Awarded suppliers of an analysis with their offer currency and whether all lines are services. */
  async awardedSuppliers(analysisId: string): Promise<AwardedSupplier[]> {
    const rows = await this.sql<
      { supplier_id: string; currency: string; all_services: boolean }[]
    >`
      select a.supplier_id, min(a.currency::text) as currency,
             bool_and(p.pr_type = 'services') as all_services
      from public.award_line a
      join public.sourcing_line s on s.id = a.sourcing_line_id
      join public.pr_line l on l.id = s.pr_line_id
      join public.purchase_requisition p on p.id = l.pr_id
      where a.tenant_id = ${this.tenantId} and a.bid_analysis_id = ${analysisId}
      group by a.supplier_id
      order by min(s.line_no)`;
    return rows.map((r) => ({
      supplierId: r.supplier_id,
      currency: r.currency,
      allServices: r.all_services ?? false,
    }));
  }

  /** A draft from the award; office and grant are copied from the event by trigger. */
  async insertFromAward(values: {
    analysisId: string;
    supplierId: string;
    kind: PoKind;
    currency: string;
    isService: boolean;
    poDate: string;
  }): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.purchase_order
        (tenant_id, kind, bid_analysis_id, supplier_id, office_id, grant_id, currency,
         is_service, po_date, delivery_address, delivery_terms, payment_terms_text)
      select ${this.tenantId}, ${values.kind}, b.id, ${values.supplierId}, e.office_id,
             e.grant_id, ${values.currency}, ${values.isService}, ${values.poDate},
             e.delivery_place, e.delivery_terms, e.payment_terms
      from public.bid_analysis b
      join public.sourcing_event e on e.id = b.sourcing_event_id
      where b.tenant_id = ${this.tenantId} and b.id = ${values.analysisId}
      returning id`;
    if (!row) throw new AppError('NOT_FOUND', 'Analysis not found');
    return row.id;
  }

  /** Draft edits; 409 VERSION_CONFLICT when stale. */
  async patch(id: string, expectedVersion: number, changes: PoPatchColumns): Promise<void> {
    const sql = this.sql;
    const rows = await sql`
      update public.purchase_order
      set ${Object.keys(changes).length ? sql(changes as Record<string, unknown>) : sql`updated_at = now()`}
      where tenant_id = ${this.tenantId} and id = ${id} and version = ${expectedVersion}
      returning id`;
    if (rows.length === 0) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
  }

  async markSubmitted(id: string, v: PoSubmitValues): Promise<number> {
    const [row] = await this.sql<{ version: number }[]>`
      update public.purchase_order
      set number = ${v.number}, status = ${v.status}, submission_cycle = ${v.submissionCycle},
          current_step_order = ${v.currentStepOrder}, submitted_at = ${v.submittedAt},
          return_reason = null, doa_currency = ${v.doaCurrency}, doa_amount = ${v.doaAmount},
          doa_rate_to_base = ${v.doaRateToBase}, doa_rate_date = ${v.doaRateDate},
          doa_rate_source = ${v.doaRateSource}, doa_exchange_rate_id = ${v.doaExchangeRateId}
      where tenant_id = ${this.tenantId} and id = ${id}
      returning version`;
    return row!.version;
  }

  async setCommitRate(id: string, rate: PoCommitRate): Promise<void> {
    await this.sql`
      update public.purchase_order
      set commit_rate_to_base = ${rate.rateToBase}, commit_rate_date = ${rate.rateDate},
          commit_rate_source = ${rate.rateSource},
          commit_exchange_rate_id = ${rate.exchangeRateId},
          grant_rate_to_base = ${rate.grantRateToBase}
      where tenant_id = ${this.tenantId} and id = ${id}`;
  }

  /** Workflow status changes (advance, approve, reject, return, cancel, touch). */
  async updateWorkflow(
    id: string,
    values: {
      status?: string;
      currentStepOrder?: number | null;
      approvedAt?: string;
      rejectReason?: string;
      returnReason?: string;
      cancelReason?: string;
      cancelledAt?: string;
    }
  ): Promise<number> {
    const sql = this.sql;
    const changes: Record<string, unknown> = {};
    if (values.status !== undefined) changes.status = values.status;
    if (values.currentStepOrder !== undefined) changes.current_step_order = values.currentStepOrder;
    if (values.approvedAt !== undefined) changes.approved_at = values.approvedAt;
    if (values.rejectReason !== undefined) changes.reject_reason = values.rejectReason;
    if (values.returnReason !== undefined) changes.return_reason = values.returnReason;
    if (values.cancelReason !== undefined) changes.cancel_reason = values.cancelReason;
    if (values.cancelledAt !== undefined) changes.cancelled_at = values.cancelledAt;
    const [row] = await sql<{ version: number }[]>`
      update public.purchase_order
      set ${Object.keys(changes).length ? sql(changes) : sql`updated_at = now()`}
      where tenant_id = ${this.tenantId} and id = ${id}
      returning version`;
    return row!.version;
  }

  async acknowledge(
    id: string,
    expectedVersion: number,
    values: { acknowledgedAt: string; acknowledgedByName: string; attachmentId: string }
  ): Promise<void> {
    const rows = await this.sql`
      update public.purchase_order
      set status = 'acknowledged', acknowledged_at = ${values.acknowledgedAt},
          acknowledged_by_name = ${values.acknowledgedByName},
          acknowledgement_attachment_id = ${values.attachmentId}
      where tenant_id = ${this.tenantId} and id = ${id} and version = ${expectedVersion}
      returning id`;
    if (rows.length === 0) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
  }

  async close(id: string, reason: string): Promise<void> {
    await this.sql`
      update public.purchase_order
      set status = 'closed', close_reason = ${reason}, closed_at = now()
      where tenant_id = ${this.tenantId} and id = ${id}`;
  }

  async setStatus(id: string, status: PurchaseOrderStatus): Promise<void> {
    await this.sql`
      update public.purchase_order set status = ${status}
      where tenant_id = ${this.tenantId} and id = ${id} and status is distinct from ${status}`;
  }

  async requireAcknowledgement(): Promise<boolean> {
    const [row] = await this.sql<{ required: boolean }[]>`
      select require_po_acknowledgement as required from public.procurement_setting
      where tenant_id = ${this.tenantId}`;
    return row?.required ?? true;
  }

  /** The grant's status (FR-096: no PO approval on a suspended or closed grant). */
  async grantStatus(id: string): Promise<string> {
    const [row] = await this.sql<{ status: string }[]>`
      select g.status from public.purchase_order p
      join public."grant" g on g.id = p.grant_id
      where p.tenant_id = ${this.tenantId} and p.id = ${id}`;
    return row?.status ?? 'active';
  }
}
