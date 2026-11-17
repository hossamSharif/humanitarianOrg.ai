// sourcing_event (RFQs and tenders, 002 data-model §4) with the PR-line lookups sourcing needs:
// sourceable lines, the locked rates for method resolution, the anti-splitting candidates
// (research D4) and the PR line / PR status changes of sourcing (FR-038). Runs inside
// withTenantTx; office scope comes from RLS.
import type {
  ListResponse,
  MethodBand,
  PrLineSourcingStatus,
  ProcurementMethod,
  SourceablePrLine,
  SourceablePrLinesQuery,
  SourcingEventStatus,
  SourcingEventSummary,
  SourcingKind,
  SplittingWarning,
} from '@ngo/shared';
import type postgres from 'postgres';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';
import { escapeLike } from './query-helpers';

type Fragment = postgres.PendingQuery<postgres.Row[]>;
type Json = Parameters<TxSql['json']>[0];

export interface SourcingEventRecord extends SourcingEventSummary {
  deliveryPlace: string | null;
  deliveryTerms: string | null;
  paymentTerms: string | null;
  currency: string;
  offerValidityDays: number | null;
  splitAwardAllowed: boolean;
  requiredMinQuotations: number;
  methodSnapshot: { tenant: MethodBand; grant: MethodBand | null };
  splittingWarning: SplittingWarning | null;
  waiverId: string | null;
  openedAt: string | null;
  deadlinePassed: boolean;
  reissuedFromId: string | null;
  reissuedToId: string | null;
  cancelReason: string | null;
  createdBy: string;
  version: number;
}

/** Header values a draft may change. */
export interface SourcingHeaderValues {
  title?: string;
  issueDate?: string | null;
  submissionDeadline?: string | null;
  deliveryPlace?: string | null;
  deliveryTerms?: string | null;
  paymentTerms?: string | null;
  currency?: string;
  offerValidityDays?: number | null;
  splitAwardAllowed?: boolean;
  chosenMethod?: ProcurementMethod;
  waiverId?: string | null;
}

const HEADER_COLUMNS: Record<keyof SourcingHeaderValues, string> = {
  title: 'title',
  issueDate: 'issue_date',
  submissionDeadline: 'submission_deadline',
  deliveryPlace: 'delivery_place',
  deliveryTerms: 'delivery_terms',
  paymentTerms: 'payment_terms',
  currency: 'currency',
  offerValidityDays: 'offer_validity_days',
  splitAwardAllowed: 'split_award_allowed',
  chosenMethod: 'chosen_method',
  waiverId: 'waiver_id',
};

export interface NewSourcingEvent extends SourcingHeaderValues {
  kind: SourcingKind;
  title: string;
  grantId: string;
  officeId: string;
  currency: string;
  requiredMethod: ProcurementMethod;
  requiredMinQuotations: number;
  chosenMethod: ProcurementMethod;
  estimatedValueDoa: string;
  doaCurrency: string;
  methodSnapshot: { tenant: MethodBand; grant: MethodBand | null };
  splittingWarning: SplittingWarning | null;
  reissuedFromId?: string | null;
}

interface Row {
  id: string;
  kind: SourcingKind;
  number: string | null;
  status: SourcingEventStatus;
  title: string;
  grant_id: string;
  grant_code: string;
  office_id: string;
  issue_date: string | null;
  submission_deadline: Date | null;
  delivery_place: string | null;
  delivery_terms: string | null;
  payment_terms: string | null;
  currency: string;
  offer_validity_days: number | null;
  split_award_allowed: boolean;
  required_method: ProcurementMethod;
  required_min_quotations: number;
  chosen_method: ProcurementMethod;
  estimated_value_doa: string;
  doa_currency: string;
  method_snapshot: { tenant: MethodBand; grant: MethodBand | null };
  splitting_warning: SplittingWarning | null;
  waiver_id: string | null;
  opened_at: Date | null;
  deadline_passed: boolean;
  reissued_from_id: string | null;
  reissued_to_id: string | null;
  cancel_reason: string | null;
  created_by: string;
  created_at: Date;
  version: number;
  line_count: number;
  invitation_count: number;
  offer_count: number;
  total?: number;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toSummary(r: Row): SourcingEventSummary {
  return {
    id: r.id,
    kind: r.kind,
    number: r.number,
    status: r.status,
    title: r.title,
    grantId: r.grant_id,
    grantCode: r.grant_code,
    officeId: r.office_id,
    issueDate: r.issue_date,
    submissionDeadline: iso(r.submission_deadline),
    requiredMethod: r.required_method,
    chosenMethod: r.chosen_method,
    estimatedValueDoa: r.estimated_value_doa,
    doaCurrency: r.doa_currency,
    lineCount: r.line_count,
    invitationCount: r.invitation_count,
    offerCount: r.offer_count,
    createdAt: r.created_at.toISOString(),
  };
}

function toRecord(r: Row): SourcingEventRecord {
  return {
    ...toSummary(r),
    deliveryPlace: r.delivery_place,
    deliveryTerms: r.delivery_terms,
    paymentTerms: r.payment_terms,
    currency: r.currency,
    offerValidityDays: r.offer_validity_days,
    splitAwardAllowed: r.split_award_allowed,
    requiredMinQuotations: r.required_min_quotations,
    methodSnapshot: r.method_snapshot,
    splittingWarning: r.splitting_warning,
    waiverId: r.waiver_id,
    openedAt: iso(r.opened_at),
    deadlinePassed: r.deadline_passed,
    reissuedFromId: r.reissued_from_id,
    reissuedToId: r.reissued_to_id,
    cancelReason: r.cancel_reason,
    createdBy: r.created_by,
    version: r.version,
  };
}

const SORTABLE: Record<string, string> = {
  number: 'e.number',
  createdAt: 'e.created_at',
  submissionDeadline: 'e.submission_deadline',
  status: 'e.status',
  title: 'e.title',
};

export interface SourcingListFilter {
  kind: SourcingKind;
  page: number;
  pageSize: number;
  sort?: { field: string; direction: 'asc' | 'desc' };
  status?: SourcingEventStatus;
  grantId?: string;
  q?: string;
}

/** A PR line as sourcing sees it, with the rates its PR locked (001 R7). */
export interface SourcingPrLine {
  id: string;
  prId: string;
  prStatus: string;
  prDate: string | null;
  grantId: string | null;
  officeId: string | null;
  sourcingStatus: PrLineSourcingStatus;
  description: string | null;
  specifications: string | null;
  currency: string;
  lineTotal: string | null;
  rateToBase: string | null;
  doaRateToBase: string | null;
  budgetCategory: string | null;
}

/** A line of another PR that the anti-splitting rule adds to the selection. */
export interface SplittingCandidate {
  prId: string;
  lineTotal: string;
  rateToBase: string;
  doaRateToBase: string;
}

export class SourcingEventRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  private select(where: Fragment, tail: Fragment = this.sql``) {
    return this.sql<Row[]>`
      select e.id, e.kind, e.number,
             -- 'closed' is derived while issued and past the deadline (data-model §4)
             case when e.status = 'issued' and now() > e.submission_deadline then 'closed'
                  else e.status end as status,
             e.title, e.grant_id, g.code as grant_code,
             e.office_id, e.issue_date::text, e.submission_deadline, e.delivery_place,
             e.delivery_terms, e.payment_terms, e.currency::text, e.offer_validity_days,
             e.split_award_allowed, e.required_method, e.required_min_quotations,
             e.chosen_method, e.estimated_value_doa::text, e.doa_currency::text,
             e.method_snapshot, e.splitting_warning, e.waiver_id, e.opened_at,
             (e.submission_deadline is not null and now() >= e.submission_deadline)
               as deadline_passed,
             e.reissued_from_id,
             (select r.id from public.sourcing_event r where r.reissued_from_id = e.id
              order by r.created_at desc limit 1) as reissued_to_id,
             e.cancel_reason, e.created_by, e.created_at, e.version,
             (select count(*) from public.sourcing_line l
              where l.sourcing_event_id = e.id)::int as line_count,
             (select count(*) from public.sourcing_invitation i
              where i.sourcing_event_id = e.id)::int as invitation_count,
             (select count(*) from public.offer o
              where o.sourcing_event_id = e.id and o.status <> 'replaced')::int as offer_count,
             count(*) over ()::int as total
      from public.sourcing_event e
      join public."grant" g on g.id = e.grant_id
      where e.tenant_id = ${this.tenantId} ${where}
      ${tail}`;
  }

  async list(filter: SourcingListFilter): Promise<ListResponse<SourcingEventSummary>> {
    const sql = this.sql;
    const { page, pageSize } = filter;
    const sort = filter.sort ?? { field: 'createdAt', direction: 'desc' as const };
    const column = SORTABLE[sort.field];
    if (!column) {
      throw new AppError('VALIDATION_ERROR', `Cannot sort by ${sort.field}`, [
        { field: 'query.sort', message: 'unsupported_field' },
      ]);
    }
    const like = filter.q ? `%${escapeLike(filter.q)}%` : null;
    const rows = await this.select(
      sql`
        and e.kind = ${filter.kind}
        ${
          filter.status === 'closed'
            ? sql`and (e.status = 'closed'
                       or (e.status = 'issued' and now() > e.submission_deadline))`
            : filter.status === 'issued'
              ? sql`and e.status = 'issued' and not (now() > e.submission_deadline)`
              : filter.status
                ? sql`and e.status = ${filter.status}`
                : sql``
        }
        ${filter.grantId ? sql`and e.grant_id = ${filter.grantId}` : sql``}
        ${like ? sql`and (e.title ilike ${like} or e.number ilike ${like})` : sql``}`,
      sql`order by ${sql.unsafe(column)} ${sql.unsafe(sort.direction)} nulls last, e.id
          limit ${pageSize} offset ${(page - 1) * pageSize}`
    );
    return { data: rows.map(toSummary), page, pageSize, total: rows[0]?.total ?? 0 };
  }

  async find(id: string, kind?: SourcingKind): Promise<SourcingEventRecord | null> {
    const sql = this.sql;
    const [row] = await this.select(
      sql`and e.id = ${id} ${kind ? sql`and e.kind = ${kind}` : sql``}`
    );
    return row ? toRecord(row) : null;
  }

  async get(id: string, kind?: SourcingKind): Promise<SourcingEventRecord> {
    const event = await this.find(id, kind);
    if (!event) throw new AppError('NOT_FOUND', 'Sourcing event not found');
    return event;
  }

  /** Locks the header first (001 R4) and returns its state. */
  async lock(
    id: string,
    kind?: SourcingKind
  ): Promise<{ status: SourcingEventStatus; version: number; kind: SourcingKind }> {
    const sql = this.sql;
    const [row] = await sql<{ status: SourcingEventStatus; version: number; kind: SourcingKind }[]>`
      select status, version, kind from public.sourcing_event
      where tenant_id = ${this.tenantId} and id = ${id}
        ${kind ? sql`and kind = ${kind}` : sql``}
      for update`;
    if (!row) throw new AppError('NOT_FOUND', 'Sourcing event not found');
    return row;
  }

  async insert(values: NewSourcingEvent): Promise<string> {
    const sql = this.sql;
    const [row] = await sql<{ id: string }[]>`
      insert into public.sourcing_event ${sql({
        tenant_id: this.tenantId,
        kind: values.kind,
        title: values.title,
        grant_id: values.grantId,
        office_id: values.officeId,
        currency: values.currency,
        issue_date: values.issueDate ?? null,
        submission_deadline: values.submissionDeadline ?? null,
        delivery_place: values.deliveryPlace ?? null,
        delivery_terms: values.deliveryTerms ?? null,
        payment_terms: values.paymentTerms ?? null,
        offer_validity_days: values.offerValidityDays ?? null,
        split_award_allowed: values.splitAwardAllowed ?? false,
        required_method: values.requiredMethod,
        required_min_quotations: values.requiredMinQuotations,
        chosen_method: values.chosenMethod,
        estimated_value_doa: values.estimatedValueDoa,
        doa_currency: values.doaCurrency,
        method_snapshot: sql.json(values.methodSnapshot as unknown as Json),
        splitting_warning: values.splittingWarning
          ? sql.json(values.splittingWarning as unknown as Json)
          : null,
        reissued_from_id: values.reissuedFromId ?? null,
      })}
      returning id`;
    return row!.id;
  }

  /** Draft edits; 409 VERSION_CONFLICT when `expectedVersion` is stale. */
  async update(id: string, values: SourcingHeaderValues, expectedVersion: number): Promise<void> {
    const sql = this.sql;
    const changes: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(HEADER_COLUMNS)) {
      const value = values[key as keyof SourcingHeaderValues];
      if (value !== undefined) changes[column] = value;
    }
    const rows = await sql`
      update public.sourcing_event
      set ${Object.keys(changes).length ? sql(changes) : sql`updated_at = now()`}
      where tenant_id = ${this.tenantId} and id = ${id} and version = ${expectedVersion}
      returning id`;
    if (rows.length === 0) {
      throw new AppError('VERSION_CONFLICT', 'The record was changed by someone else');
    }
  }

  async markIssued(id: string, number: string, issueDate: string): Promise<void> {
    await this.sql`
      update public.sourcing_event
      set status = 'issued', number = ${number}, issue_date = ${issueDate},
          submitted_at = now(), submission_cycle = 1
      where tenant_id = ${this.tenantId} and id = ${id}`;
  }

  async markCancelled(id: string, reason: string): Promise<void> {
    await this.sql`
      update public.sourcing_event
      set status = 'cancelled', cancelled_at = now(), cancel_reason = ${reason}
      where tenant_id = ${this.tenantId} and id = ${id}`;
  }

  /**
   * The opening command (research D3): the only writer of opened_at, flagged to the guard
   * trigger by a transaction-local setting.
   */
  async markOpened(id: string, openedAt: Date): Promise<void> {
    await this.sql`select set_config('app.opening_command', 'on', true)`;
    await this.sql`
      update public.sourcing_event set status = 'opened', opened_at = ${openedAt}
      where tenant_id = ${this.tenantId} and id = ${id}`;
    await this.sql`select set_config('app.opening_command', '', true)`;
  }

  async setStatus(id: string, status: SourcingEventStatus): Promise<void> {
    await this.sql`
      update public.sourcing_event set status = ${status}
      where tenant_id = ${this.tenantId} and id = ${id}`;
  }

  // --- PR lines ------------------------------------------------------------------------------

  /** Approved PR lines that no event holds (GET /sourcing/pr-lines). */
  async sourceablePrLines(filter: SourceablePrLinesQuery): Promise<SourceablePrLine[]> {
    const sql = this.sql;
    const like = filter.q ? `%${escapeLike(filter.q)}%` : null;
    const rows = await sql<
      {
        id: string;
        pr_id: string;
        pr_number: string | null;
        pr_date: string;
        grant_id: string;
        grant_code: string;
        office_id: string;
        line_no: number;
        description: string | null;
        specifications: string | null;
        quantity: string;
        unit_id: string | null;
        unit_code: string | null;
        unit_cost: string;
        line_total: string;
        currency: string;
        budget_line_id: string | null;
        budget_line_code: string | null;
      }[]
    >`
      select l.id, p.id as pr_id, p.number as pr_number, p.pr_date::text, p.grant_id,
             g.code as grant_code, p.requesting_office_id as office_id, l.line_no,
             l.description, l.specifications, l.quantity::text, l.unit_id, u.code as unit_code,
             l.unit_cost::text, l.line_total::text, l.currency::text, l.budget_line_id,
             b.code as budget_line_code
      from public.pr_line l
      join public.purchase_requisition p on p.id = l.pr_id
      join public."grant" g on g.id = p.grant_id
      left join public.unit_of_measure u on u.id = l.unit_id
      left join public.budget_line b on b.id = l.budget_line_id
      where l.tenant_id = ${this.tenantId}
        and p.status in ('approved', 'in_procurement')
        and l.sourcing_status = 'not_sourced'
        ${filter.grantId ? sql`and p.grant_id = ${filter.grantId}` : sql``}
        ${filter.officeId ? sql`and p.requesting_office_id = ${filter.officeId}` : sql``}
        ${
          like
            ? sql`and (p.number ilike ${like} or l.description ilike ${like}
                       or g.code ilike ${like})`
            : sql``
        }
      order by p.pr_date desc, p.number, l.line_no
      limit 500`;
    return rows.map((r) => ({
      id: r.id,
      prId: r.pr_id,
      prNumber: r.pr_number,
      prDate: r.pr_date,
      grantId: r.grant_id,
      grantCode: r.grant_code,
      officeId: r.office_id,
      lineNo: r.line_no,
      description: r.description,
      specifications: r.specifications,
      quantity: r.quantity,
      unitId: r.unit_id,
      unitCode: r.unit_code,
      unitCost: r.unit_cost,
      lineTotal: r.line_total,
      currency: r.currency,
      budgetLineId: r.budget_line_id,
      budgetLineCode: r.budget_line_code,
    }));
  }

  /**
   * The PR lines with their PR and locked rates, row-locked in id order when status changes
   * follow (`lock`, the default).
   */
  async prLines(ids: readonly string[], options = { lock: true }): Promise<SourcingPrLine[]> {
    const sql = this.sql;
    const rows = await sql<
      {
        id: string;
        pr_id: string;
        pr_status: string;
        pr_date: string | null;
        grant_id: string | null;
        office_id: string | null;
        sourcing_status: PrLineSourcingStatus;
        description: string | null;
        specifications: string | null;
        currency: string;
        line_total: string | null;
        rate_to_base: string | null;
        doa_rate_to_base: string | null;
        budget_category: string | null;
      }[]
    >`
      select l.id, p.id as pr_id, p.status as pr_status, p.pr_date::text, p.grant_id,
             p.requesting_office_id as office_id, l.sourcing_status, l.description,
             l.specifications, l.currency::text, l.line_total::text, l.rate_to_base::text,
             p.doa_rate_to_base::text, b.category as budget_category
      from public.pr_line l
      join public.purchase_requisition p on p.id = l.pr_id
      left join public.budget_line b on b.id = l.budget_line_id
      where l.tenant_id = ${this.tenantId} and l.id = any (${sql.array([...ids])}::uuid[])
      order by l.id
      ${options.lock ? sql`for update of l` : sql``}`;
    return rows.map((r) => ({
      id: r.id,
      prId: r.pr_id,
      prStatus: r.pr_status,
      prDate: r.pr_date,
      grantId: r.grant_id,
      officeId: r.office_id,
      sourcingStatus: r.sourcing_status,
      description: r.description,
      specifications: r.specifications,
      currency: r.currency,
      lineTotal: r.line_total,
      rateToBase: r.rate_to_base,
      doaRateToBase: r.doa_rate_to_base,
      budgetCategory: r.budget_category,
    }));
  }

  /** The open event holding any of these PR lines (BR-22). */
  async openEventFor(
    prLineIds: readonly string[]
  ): Promise<{ eventId: string; prLineIds: string[] } | null> {
    const sql = this.sql;
    const rows = await sql<{ sourcing_event_id: string; pr_line_id: string }[]>`
      select sourcing_event_id, pr_line_id from public.sourcing_line
      where tenant_id = ${this.tenantId} and is_open
        and pr_line_id = any (${sql.array([...prLineIds])}::uuid[])`;
    if (rows.length === 0) return null;
    const eventId = rows[0]!.sourcing_event_id;
    return { eventId, prLineIds: rows.map((r) => r.pr_line_id) };
  }

  /**
   * Lines of other PRs of the same office and grant, with a budget line of the same category,
   * dated within `windowDays` of the selected PRs, already in a live or awarded event of the
   * same or a lower method (research D4, FR-053).
   */
  async splittingCandidates(input: {
    prLineIds: readonly string[];
    grantId: string;
    officeId: string;
    categories: readonly string[];
    prDates: readonly string[];
    windowDays: number;
    maxRank: number;
    excludeEventId: string | null;
  }): Promise<SplittingCandidate[]> {
    const sql = this.sql;
    if (input.categories.length === 0 || input.prDates.length === 0) return [];
    const rows = await sql<
      { pr_id: string; line_total: string; rate_to_base: string; doa_rate_to_base: string }[]
    >`
      select distinct on (l.id) p.id as pr_id, l.line_total::text, l.rate_to_base::text,
             p.doa_rate_to_base::text
      from public.sourcing_line s
      join public.sourcing_event e on e.id = s.sourcing_event_id
      join public.pr_line l on l.id = s.pr_line_id
      join public.purchase_requisition p on p.id = l.pr_id
      join public.budget_line b on b.id = l.budget_line_id
      where e.tenant_id = ${this.tenantId}
        and e.status <> 'cancelled'
        and e.id is distinct from ${input.excludeEventId}::uuid
        and not (l.id = any (${sql.array([...input.prLineIds])}::uuid[]))
        and p.requesting_office_id = ${input.officeId}
        and p.grant_id = ${input.grantId}
        and b.category = any (${sql.array([...input.categories])}::text[])
        and exists (
          select 1 from unnest(${sql.array([...input.prDates])}::date[]) d
          where abs(p.pr_date - d) <= ${input.windowDays}
        )
        and (case e.chosen_method when 'direct' then 1 when 'rfq' then 2 else 3 end)
            <= ${input.maxRank}
        and l.line_total is not null and l.rate_to_base is not null
        and p.doa_rate_to_base is not null
      order by l.id`;
    return rows.map((r) => ({
      prId: r.pr_id,
      lineTotal: r.line_total,
      rateToBase: r.rate_to_base,
      doaRateToBase: r.doa_rate_to_base,
    }));
  }

  async setPrLineStatus(ids: readonly string[], status: PrLineSourcingStatus): Promise<void> {
    if (ids.length === 0) return;
    const sql = this.sql;
    await sql`
      update public.pr_line set sourcing_status = ${status}
      where tenant_id = ${this.tenantId} and id = any (${sql.array([...ids])}::uuid[])`;
  }

  /**
   * An approved PR moves to in_procurement on its first sourced line; it goes back to approved
   * when no line is sourced or ordered any more (FR-038). Closing is the PO's (US6).
   */
  async refreshPrStatuses(prIds: readonly string[]): Promise<void> {
    if (prIds.length === 0) return;
    const sql = this.sql;
    await sql`
      update public.purchase_requisition p
      set status = case
        when exists (select 1 from public.pr_line l where l.pr_id = p.id
                     and l.sourcing_status in ('in_sourcing', 'ordered'))
          then 'in_procurement' else 'approved' end
      where p.tenant_id = ${this.tenantId}
        and p.id = any (${sql.array([...prIds])}::uuid[])
        and p.status in ('approved', 'in_procurement')`;
  }

  // --- tenant facts --------------------------------------------------------------------------

  async tenantFacts(): Promise<{
    timeZone: string;
    doaCurrency: string;
    baseCurrency: string;
    today: string;
  }> {
    const [row] = await this.sql<
      { timezone: string; doa_reference_currency: string; base_currency: string; today: string }[]
    >`
      select t.timezone, t.doa_reference_currency::text, t.base_currency::text,
             (now() at time zone t.timezone)::date::text as today
      from public.tenant t where t.id = ${this.tenantId}`;
    if (!row) throw new AppError('NOT_FOUND', 'Organization not found');
    return {
      timeZone: row.timezone,
      doaCurrency: row.doa_reference_currency,
      baseCurrency: row.base_currency,
      today: row.today,
    };
  }

  /** The event's live (not cancelled) analysis. */
  async liveAnalysisId(id: string): Promise<string | null> {
    const [row] = await this.sql<{ id: string }[]>`
      select id from public.bid_analysis
      where tenant_id = ${this.tenantId} and sourcing_event_id = ${id} and status <> 'cancelled'`;
    return row?.id ?? null;
  }

  /** Whether a splitting warning was acknowledged (doc_signature acknowledge_warning). */
  async splittingAcknowledged(id: string, docType: 'RFQ' | 'TND'): Promise<boolean> {
    const [row] = await this.sql<{ id: string }[]>`
      select id from public.doc_signature
      where tenant_id = ${this.tenantId} and doc_type = ${docType} and doc_id = ${id}
        and action = 'acknowledge_warning'
      limit 1`;
    return row !== undefined;
  }
}
