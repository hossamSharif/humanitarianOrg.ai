// bid_analysis (⟨doc⟩ ⟨doa⟩, numbering QA, DoA type AWARD; data-model §4, research R22): one live
// analysis per sourcing event. Header reads and writes for the analysis service and the AWARD
// adapter; office scope comes from RLS.
import type {
  BidAnalysisStatus,
  BidAnalysisSummary,
  ComparisonRate,
  ListResponse,
} from '@ngo/shared';
import type postgres from 'postgres';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

type Json = Parameters<TxSql['json']>[0];

export interface BidAnalysisRecord extends BidAnalysisSummary {
  officeId: string;
  createdBy: string;
  version: number;
  submissionCycle: number;
  currentStepOrder: number | null;
  comparisonRates: ComparisonRate[];
  recommendedOfferId: string | null;
  highestOfferId: string | null;
  justification: string | null;
  justificationCriterionIds: string[];
  waiverId: string | null;
  awardedAmountDoa: string | null;
  doaCurrency: string | null;
  frozenAt: string | null;
  /** the event's facts the analysis works with */
  eventKind: 'rfq' | 'tender';
  eventStatus: string;
  eventOpenedAt: string | null;
  splitAwardAllowed: boolean;
  requiredMinQuotations: number;
}

interface Row {
  id: string;
  number: string | null;
  status: BidAnalysisStatus;
  sourcing_event_id: string;
  event_number: string | null;
  event_title: string;
  awarded_amount: string | null;
  event_currency: string;
  created_at: Date;
  office_id: string;
  created_by: string;
  version: number;
  submission_cycle: number;
  current_step_order: number | null;
  comparison_rates: ComparisonRate[];
  recommended_offer_id: string | null;
  highest_offer_id: string | null;
  justification: string | null;
  justification_criterion_ids: string[];
  waiver_id: string | null;
  awarded_amount_doa: string | null;
  doa_currency: string | null;
  frozen_at: Date | null;
  event_kind: 'rfq' | 'tender';
  event_status: string;
  event_opened_at: Date | null;
  split_award_allowed: boolean;
  required_min_quotations: number;
  total?: number;
}

function toRecord(r: Row): BidAnalysisRecord {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    sourcingEventId: r.sourcing_event_id,
    eventNumber: r.event_number,
    eventTitle: r.event_title,
    awardedAmount: r.awarded_amount,
    eventCurrency: r.event_currency,
    createdAt: r.created_at.toISOString(),
    officeId: r.office_id,
    createdBy: r.created_by,
    version: r.version,
    submissionCycle: r.submission_cycle,
    currentStepOrder: r.current_step_order,
    comparisonRates: r.comparison_rates,
    recommendedOfferId: r.recommended_offer_id,
    highestOfferId: r.highest_offer_id,
    justification: r.justification,
    justificationCriterionIds: r.justification_criterion_ids,
    waiverId: r.waiver_id,
    awardedAmountDoa: r.awarded_amount_doa,
    doaCurrency: r.doa_currency,
    frozenAt: r.frozen_at?.toISOString() ?? null,
    eventKind: r.event_kind,
    eventStatus: r.event_status,
    eventOpenedAt: r.event_opened_at?.toISOString() ?? null,
    splitAwardAllowed: r.split_award_allowed,
    requiredMinQuotations: r.required_min_quotations,
  };
}

const toSummary = (r: Row): BidAnalysisSummary => ({
  id: r.id,
  number: r.number,
  status: r.status,
  sourcingEventId: r.sourcing_event_id,
  eventNumber: r.event_number,
  eventTitle: r.event_title,
  awardedAmount: r.awarded_amount,
  eventCurrency: r.event_currency,
  createdAt: r.created_at.toISOString(),
});

/** Columns the AWARD adapter writes at submission (⟨doa⟩ locked, 001 R7). */
export interface AnalysisSubmitValues {
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
  waiverId: string | null;
}

export class BidAnalysisRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  private select(where: postgres.PendingQuery<postgres.Row[]>, tail = this.sql``) {
    return this.sql<Row[]>`
      select b.id, b.number, b.status, b.sourcing_event_id, e.number as event_number,
             e.title as event_title, b.awarded_amount::text, e.currency::text as event_currency,
             b.created_at, b.office_id, b.created_by, b.version, b.submission_cycle,
             b.current_step_order, b.comparison_rates, b.recommended_offer_id,
             b.highest_offer_id, b.justification, b.justification_criterion_ids, b.waiver_id,
             b.awarded_amount_doa::text, b.doa_currency::text, b.frozen_at,
             e.kind as event_kind, e.status as event_status, e.opened_at as event_opened_at,
             e.split_award_allowed, e.required_min_quotations,
             count(*) over ()::int as total
      from public.bid_analysis b
      join public.sourcing_event e on e.id = b.sourcing_event_id
      where b.tenant_id = ${this.tenantId} ${where}
      ${tail}`;
  }

  async list(filter: {
    page: number;
    pageSize: number;
    status?: BidAnalysisStatus;
  }): Promise<ListResponse<BidAnalysisSummary>> {
    const sql = this.sql;
    const { page, pageSize } = filter;
    const rows = await this.select(
      filter.status ? sql`and b.status = ${filter.status}` : sql``,
      sql`order by b.created_at desc, b.id limit ${pageSize} offset ${(page - 1) * pageSize}`
    );
    return { data: rows.map(toSummary), page, pageSize, total: rows[0]?.total ?? 0 };
  }

  async find(id: string, options: { lock?: boolean } = {}): Promise<BidAnalysisRecord | null> {
    if (options.lock) {
      const [locked] = await this.sql<{ id: string }[]>`
        select id from public.bid_analysis
        where tenant_id = ${this.tenantId} and id = ${id}
        for update`;
      if (!locked) return null;
    }
    const [row] = await this.select(this.sql`and b.id = ${id}`);
    return row ? toRecord(row) : null;
  }

  async get(id: string, options: { lock?: boolean } = {}): Promise<BidAnalysisRecord> {
    const analysis = await this.find(id, options);
    if (!analysis) throw new AppError('NOT_FOUND', 'Analysis not found');
    return analysis;
  }

  /** The live (not cancelled) analysis of an event. */
  async liveForEvent(eventId: string): Promise<{ id: string } | null> {
    const [row] = await this.sql<{ id: string }[]>`
      select id from public.bid_analysis
      where tenant_id = ${this.tenantId} and sourcing_event_id = ${eventId}
        and status <> 'cancelled'`;
    return row ?? null;
  }

  async insert(eventId: string, comparisonRates: ComparisonRate[]): Promise<string> {
    const sql = this.sql;
    // office_id is copied from the event by trigger; the placeholder satisfies not null first
    const [row] = await sql<{ id: string }[]>`
      insert into public.bid_analysis (tenant_id, sourcing_event_id, office_id, comparison_rates)
      select ${this.tenantId}, e.id, e.office_id, ${sql.json(comparisonRates as unknown as Json)}
      from public.sourcing_event e
      where e.tenant_id = ${this.tenantId} and e.id = ${eventId}
      returning id`;
    if (!row) throw new AppError('NOT_FOUND', 'Sourcing event not found');
    return row.id;
  }

  /** Draft / scoring edits; 409 VERSION_CONFLICT when stale. */
  async touch(id: string, expectedVersion: number): Promise<void> {
    const rows = await this.sql`
      update public.bid_analysis set updated_at = now()
      where tenant_id = ${this.tenantId} and id = ${id} and version = ${expectedVersion}
      returning id`;
    if (rows.length === 0) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
  }

  async setStatus(id: string, status: BidAnalysisStatus): Promise<void> {
    await this.sql`
      update public.bid_analysis set status = ${status}
      where tenant_id = ${this.tenantId} and id = ${id}`;
  }

  async setHighest(id: string, highestOfferId: string | null): Promise<void> {
    await this.sql`
      update public.bid_analysis set highest_offer_id = ${highestOfferId}
      where tenant_id = ${this.tenantId} and id = ${id}
        and highest_offer_id is distinct from ${highestOfferId}::uuid`;
  }

  async setRecommendation(
    id: string,
    values: {
      recommendedOfferId: string | null;
      justification: string | null;
      justificationCriterionIds: readonly string[];
      awardedAmount: string;
    }
  ): Promise<void> {
    const sql = this.sql;
    await sql`
      update public.bid_analysis
      set recommended_offer_id = ${values.recommendedOfferId},
          justification = ${values.justification},
          justification_criterion_ids = ${sql.array([...values.justificationCriterionIds])}::uuid[],
          awarded_amount = ${values.awardedAmount}
      where tenant_id = ${this.tenantId} and id = ${id}`;
  }

  /** The first committee signature freezes the results (FR-029). */
  async freeze(id: string): Promise<void> {
    await this.sql`
      update public.bid_analysis
      set frozen_at = now(), status = 'signing'
      where tenant_id = ${this.tenantId} and id = ${id} and frozen_at is null`;
  }

  async markSubmitted(id: string, v: AnalysisSubmitValues): Promise<number> {
    const [row] = await this.sql<{ version: number }[]>`
      update public.bid_analysis
      set number = ${v.number}, status = ${v.status}, submission_cycle = ${v.submissionCycle},
          current_step_order = ${v.currentStepOrder}, submitted_at = ${v.submittedAt},
          return_reason = null, doa_currency = ${v.doaCurrency}, doa_amount = ${v.doaAmount},
          awarded_amount_doa = ${v.doaAmount}, doa_rate_to_base = ${v.doaRateToBase},
          doa_rate_date = ${v.doaRateDate}, doa_rate_source = ${v.doaRateSource},
          doa_exchange_rate_id = ${v.doaExchangeRateId}, waiver_id = ${v.waiverId}
      where tenant_id = ${this.tenantId} and id = ${id}
      returning version`;
    return row!.version;
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
      update public.bid_analysis
      set ${Object.keys(changes).length ? sql(changes) : sql`updated_at = now()`}
      where tenant_id = ${this.tenantId} and id = ${id}
      returning version`;
    return row!.version;
  }

  /** Requesters of every PR feeding the event (segregation pr_creator_approves_award). */
  async prRequesterIds(eventId: string): Promise<string[]> {
    const rows = await this.sql<{ requester_id: string }[]>`
      select distinct p.requester_id
      from public.sourcing_line s
      join public.pr_line l on l.id = s.pr_line_id
      join public.purchase_requisition p on p.id = l.pr_id
      where s.tenant_id = ${this.tenantId} and s.sourcing_event_id = ${eventId}`;
    return rows.map((r) => r.requester_id);
  }

  async committeeMinSize(): Promise<number> {
    const [row] = await this.sql<{ n: number }[]>`
      select committee_min_size as n from public.procurement_setting
      where tenant_id = ${this.tenantId}`;
    return row?.n ?? 3;
  }
}
