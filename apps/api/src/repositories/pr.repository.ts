// Purchase requisition header and lines (data-model §4), plus the reference reads the PR
// services need (tenant settings, grant, budget-line/activity grants, actor snapshot, print
// labels). Every PR command and read runs inside withTenantTx, so RLS applies as the caller and
// one transaction can lock the PR and its budget lines (research R4).
import type { PrStatus, PrType } from '@ngo/shared';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

export interface PrHeaderValues {
  prDate: string | null;
  requestingOfficeId: string | null;
  grantId: string | null;
  deliverToOfficeId: string | null;
  deliveryAddress: string | null;
  contactName: string | null;
  contactPhone: string | null;
  requiredByDate: string | null;
  activityId: string | null;
  purpose: string | null;
  prType: PrType | null;
}

export const HEADER_FIELDS = [
  'prDate',
  'requestingOfficeId',
  'grantId',
  'deliverToOfficeId',
  'deliveryAddress',
  'contactName',
  'contactPhone',
  'requiredByDate',
  'activityId',
  'purpose',
  'prType',
] as const satisfies readonly (keyof PrHeaderValues)[];

export interface PrRecord extends PrHeaderValues {
  id: string;
  number: string | null;
  status: PrStatus;
  version: number;
  requesterId: string;
  requesterName: string | null;
  requesterPosition: string | null;
  submissionCycle: number;
  currentStepOrder: number | null;
  doaCurrency: string | null;
  doaAmount: string | null;
  doaRateToBase: string | null;
  doaRateDate: string | null;
  doaRateSource: string | null;
  grantRateToBase: string | null;
  grantRateDate: string | null;
  grantRateSource: string | null;
  totalGrantCurrency: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  returnReason: string | null;
  rejectReason: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrLineValues {
  description: string | null;
  specifications: string | null;
  quantity: string | null;
  unitId: string | null;
  unitCost: string | null;
  currency: string;
  budgetLineId: string | null;
  locationOfficeId: string | null;
  activityId: string | null;
}

export const LINE_FIELDS = [
  'description',
  'specifications',
  'quantity',
  'unitId',
  'unitCost',
  'currency',
  'budgetLineId',
  'locationOfficeId',
  'activityId',
] as const satisfies readonly (keyof PrLineValues)[];

export interface PrLineRecord extends PrLineValues {
  id: string;
  lineNo: number;
  lineTotal: string | null;
  rateToBase: string | null;
  rateDate: string | null;
  rateSource: string | null;
  exchangeRateId: string | null;
  amountGrant: string | null;
}

/** Rate and grant-currency amount copied onto a line at submission (FR-028). */
export interface LockedLineValues {
  rateToBase: string;
  rateDate: string;
  rateSource: string;
  exchangeRateId: string | null;
  amountGrant: string;
}

/** Header fields written by a successful submit. */
export interface SubmissionValues {
  number: string;
  submissionCycle: number;
  currentStepOrder: number;
  submittedAt: string;
  requesterName: string;
  requesterPosition: string | null;
  doaCurrency: string;
  doaAmount: string;
  doaRateToBase: string;
  doaRateDate: string;
  doaRateSource: string;
  doaExchangeRateId: string | null;
  grantRateToBase: string;
  grantRateDate: string;
  grantRateSource: string;
  grantExchangeRateId: string | null;
  totalGrantCurrency: string;
  printSnapshot: PrintSnapshot;
}

export interface TenantSettings {
  baseCurrency: string;
  doaReferenceCurrency: string;
  timeZone: string;
  maxBackdateDays: number;
}

export interface PrGrantRef {
  id: string;
  currency: string;
  status: 'active' | 'suspended' | 'closed';
  startDate: string;
  endDate: string;
  officeIds: string[];
}

export interface ActorSnapshot {
  nameAr: string;
  nameEn: string;
  position: string | null;
}

interface Label {
  code: string;
  nameAr: string;
  nameEn: string;
}

/**
 * Labels frozen at submission so later configuration edits never change a submitted PR's
 * printout (data-model §4 `print_snapshot`, Principle VI).
 */
export interface PrintSnapshot {
  organization: {
    nameAr: string;
    nameEn: string;
    logoPath: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  requestingOffice: Label | null;
  deliverTo: Label | null;
  grant: { code: string; name: string } | null;
  donor: { name: string; shortName: string | null } | null;
  activity: { code: string; name: string } | null;
  requester: ActorSnapshot | null;
  lines: Record<
    string,
    {
      unit: Label | null;
      budgetLineCode: string | null;
      budgetLocation: Label | null;
      donorShortName: string | null;
    }
  >;
}

/** Header, lines and reference reads/writes of one PR command (one transaction). */
export interface PrStore {
  /** `FOR UPDATE`; null when missing or not visible to the caller (RLS). */
  lock(id: string): Promise<PrRecord | null>;
  find(id: string): Promise<PrRecord | null>;
  lines(prId: string): Promise<PrLineRecord[]>;
  insert(values: PrHeaderValues): Promise<PrRecord>;
  /** Writes the changed header fields; the bump_version trigger returns the new version. */
  updateHeader(id: string, values: Partial<PrHeaderValues>): Promise<number>;
  /** Version bump for a save that only changed lines. */
  touch(id: string): Promise<number>;
  delete(id: string): Promise<void>;
  /** Inserts at the given line numbers; returns the new ids in order. */
  insertLines(prId: string, lines: (PrLineValues & { lineNo: number })[]): Promise<string[]>;
  updateLine(id: string, values: Partial<PrLineValues> & { lineNo?: number }): Promise<void>;
  deleteLines(ids: readonly string[]): Promise<void>;
  /** Clears budget lines and activities of every line (before a grant change). */
  clearGrantLinks(prId: string): Promise<void>;

  settings(): Promise<TenantSettings>;
  grant(id: string): Promise<PrGrantRef | null>;
  /** budget line id → grant id, for the ids that exist */
  budgetLineGrants(ids: readonly string[]): Promise<Map<string, string>>;
  /** activity id → grant id */
  activityGrants(ids: readonly string[]): Promise<Map<string, string>>;
  /** ISO code → minor units */
  minorUnits(codes: readonly string[]): Promise<Map<string, number>>;
  actor(userId: string): Promise<ActorSnapshot>;
  printSnapshot(prId: string): Promise<PrintSnapshot>;

  lockLine(id: string, values: LockedLineValues): Promise<void>;
  markSubmitted(id: string, values: SubmissionValues): Promise<number>;
}

// ---------------------------------------------------------------------------------------------

interface PrDbRow {
  id: string;
  number: string | null;
  status: PrStatus;
  version: number;
  pr_date: string | null;
  requesting_office_id: string | null;
  grant_id: string | null;
  deliver_to_office_id: string | null;
  delivery_address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  required_by_date: string | null;
  activity_id: string | null;
  purpose: string | null;
  pr_type: PrType | null;
  requester_id: string;
  requester_name: string | null;
  requester_position: string | null;
  submission_cycle: number;
  current_step_order: number | null;
  doa_currency: string | null;
  doa_amount: string | null;
  doa_rate_to_base: string | null;
  doa_rate_date: string | null;
  doa_rate_source: string | null;
  grant_rate_to_base: string | null;
  grant_rate_date: string | null;
  grant_rate_source: string | null;
  total_grant_currency: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  return_reason: string | null;
  reject_reason: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

function toPr(r: PrDbRow): PrRecord {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    version: r.version,
    prDate: r.pr_date,
    requestingOfficeId: r.requesting_office_id,
    grantId: r.grant_id,
    deliverToOfficeId: r.deliver_to_office_id,
    deliveryAddress: r.delivery_address,
    contactName: r.contact_name,
    contactPhone: r.contact_phone,
    requiredByDate: r.required_by_date,
    activityId: r.activity_id,
    purpose: r.purpose,
    prType: r.pr_type,
    requesterId: r.requester_id,
    requesterName: r.requester_name,
    requesterPosition: r.requester_position,
    submissionCycle: r.submission_cycle,
    currentStepOrder: r.current_step_order,
    doaCurrency: r.doa_currency,
    doaAmount: r.doa_amount,
    doaRateToBase: r.doa_rate_to_base,
    doaRateDate: r.doa_rate_date,
    doaRateSource: r.doa_rate_source,
    grantRateToBase: r.grant_rate_to_base,
    grantRateDate: r.grant_rate_date,
    grantRateSource: r.grant_rate_source,
    totalGrantCurrency: r.total_grant_currency,
    submittedAt: r.submitted_at,
    approvedAt: r.approved_at,
    returnReason: r.return_reason,
    rejectReason: r.reject_reason,
    cancelReason: r.cancel_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// numerics, dates and instants leave Postgres as text: exact decimals, no timezone shifts
const PR_COLUMNS = `
  id, number, status, version, pr_date::text as pr_date, requesting_office_id, grant_id,
  deliver_to_office_id, delivery_address, contact_name, contact_phone,
  required_by_date::text as required_by_date, activity_id, purpose, pr_type, requester_id,
  requester_name, requester_position, submission_cycle, current_step_order,
  doa_currency::text as doa_currency, doa_amount::text as doa_amount,
  doa_rate_to_base::text as doa_rate_to_base, doa_rate_date::text as doa_rate_date,
  doa_rate_source, grant_rate_to_base::text as grant_rate_to_base,
  grant_rate_date::text as grant_rate_date, grant_rate_source,
  total_grant_currency::text as total_grant_currency,
  to_json(submitted_at)#>>'{}' as submitted_at, to_json(approved_at)#>>'{}' as approved_at,
  return_reason, reject_reason, cancel_reason,
  to_json(created_at)#>>'{}' as created_at, to_json(updated_at)#>>'{}' as updated_at`;

interface LineDbRow {
  id: string;
  line_no: number;
  description: string | null;
  specifications: string | null;
  quantity: string | null;
  unit_id: string | null;
  unit_cost: string | null;
  line_total: string | null;
  currency: string;
  budget_line_id: string | null;
  location_office_id: string | null;
  activity_id: string | null;
  rate_to_base: string | null;
  rate_date: string | null;
  rate_source: string | null;
  exchange_rate_id: string | null;
  amount_grant: string | null;
}

function toLine(r: LineDbRow): PrLineRecord {
  return {
    id: r.id,
    lineNo: r.line_no,
    description: r.description,
    specifications: r.specifications,
    quantity: r.quantity,
    unitId: r.unit_id,
    unitCost: r.unit_cost,
    lineTotal: r.line_total,
    currency: r.currency,
    budgetLineId: r.budget_line_id,
    locationOfficeId: r.location_office_id,
    activityId: r.activity_id,
    rateToBase: r.rate_to_base,
    rateDate: r.rate_date,
    rateSource: r.rate_source,
    exchangeRateId: r.exchange_rate_id,
    amountGrant: r.amount_grant,
  };
}

const HEADER_COLUMN: Record<keyof PrHeaderValues, string> = {
  prDate: 'pr_date',
  requestingOfficeId: 'requesting_office_id',
  grantId: 'grant_id',
  deliverToOfficeId: 'deliver_to_office_id',
  deliveryAddress: 'delivery_address',
  contactName: 'contact_name',
  contactPhone: 'contact_phone',
  requiredByDate: 'required_by_date',
  activityId: 'activity_id',
  purpose: 'purpose',
  prType: 'pr_type',
};

const LINE_COLUMN: Record<keyof PrLineValues | 'lineNo', string> = {
  lineNo: 'line_no',
  description: 'description',
  specifications: 'specifications',
  quantity: 'quantity',
  unitId: 'unit_id',
  unitCost: 'unit_cost',
  currency: 'currency',
  budgetLineId: 'budget_line_id',
  locationOfficeId: 'location_office_id',
  activityId: 'activity_id',
};

type DbValue = string | number | boolean | null;

function toColumns<K extends string>(
  values: Partial<Record<K, DbValue | undefined>>,
  map: Record<K, string>
): Record<string, DbValue> {
  const out: Record<string, DbValue> = {};
  for (const [key, value] of Object.entries(values) as [K, DbValue | undefined][]) {
    if (value !== undefined) out[map[key]] = value;
  }
  return out;
}

export class PrRepository implements PrStore {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async lock(id: string): Promise<PrRecord | null> {
    const [row] = await this.sql.unsafe<PrDbRow[]>(
      `select ${PR_COLUMNS} from public.purchase_requisition where id = $1 for update`,
      [id]
    );
    return row ? toPr(row) : null;
  }

  async find(id: string): Promise<PrRecord | null> {
    const [row] = await this.sql.unsafe<PrDbRow[]>(
      `select ${PR_COLUMNS} from public.purchase_requisition where id = $1`,
      [id]
    );
    return row ? toPr(row) : null;
  }

  async lines(prId: string): Promise<PrLineRecord[]> {
    const rows = await this.sql<LineDbRow[]>`
      select id, line_no, description, specifications, quantity::text as quantity, unit_id,
             unit_cost::text as unit_cost, line_total::text as line_total,
             currency::text as currency, budget_line_id, location_office_id, activity_id,
             rate_to_base::text as rate_to_base, rate_date::text as rate_date, rate_source,
             exchange_rate_id, amount_grant::text as amount_grant
      from public.pr_line where pr_id = ${prId}
      order by line_no`;
    return rows.map(toLine);
  }

  async insert(values: PrHeaderValues): Promise<PrRecord> {
    const columns = { ...toColumns(values, HEADER_COLUMN), tenant_id: this.tenantId };
    const [created] = await this.sql<{ id: string }[]>`
      insert into public.purchase_requisition ${this.sql(columns)} returning id`;
    return (await this.find(created!.id))!;
  }

  async updateHeader(id: string, values: Partial<PrHeaderValues>): Promise<number> {
    const columns = toColumns(values, HEADER_COLUMN);
    if (Object.keys(columns).length === 0) return this.touch(id);
    const [row] = await this.sql<{ version: number }[]>`
      update public.purchase_requisition set ${this.sql(columns)}
      where id = ${id} returning version`;
    if (!row) throw new AppError('NOT_FOUND', 'purchase_requisition not found');
    return row.version;
  }

  async touch(id: string): Promise<number> {
    const [row] = await this.sql<{ version: number }[]>`
      update public.purchase_requisition set updated_at = now()
      where id = ${id} returning version`;
    if (!row) throw new AppError('NOT_FOUND', 'purchase_requisition not found');
    return row.version;
  }

  async delete(id: string): Promise<void> {
    const rows = await this
      .sql`delete from public.purchase_requisition where id = ${id} returning id`;
    if (rows.length === 0) throw new AppError('NOT_FOUND', 'purchase_requisition not found');
  }

  async insertLines(prId: string, lines: (PrLineValues & { lineNo: number })[]) {
    if (lines.length === 0) return [];
    // line_no is unique per PR, checked at commit (renumbering a draft shifts many lines)
    await this.sql`set constraints public.pr_line_pr_line_no_key deferred`;
    const rows = await this.sql<{ id: string; line_no: number }[]>`
      insert into public.pr_line ${this.sql(
        lines.map((l) => ({
          ...toColumns(l, LINE_COLUMN),
          tenant_id: this.tenantId,
          pr_id: prId,
        }))
      )}
      returning id, line_no`;
    const byNo = new Map(rows.map((r) => [r.line_no, r.id]));
    return lines.map((l) => byNo.get(l.lineNo)!);
  }

  async updateLine(id: string, values: Partial<PrLineValues> & { lineNo?: number }) {
    const columns = toColumns(values, LINE_COLUMN);
    if (Object.keys(columns).length === 0) return;
    await this.sql`set constraints public.pr_line_pr_line_no_key deferred`;
    await this.sql`update public.pr_line set ${this.sql(columns)} where id = ${id}`;
  }

  async deleteLines(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.sql`delete from public.pr_line where id in ${this.sql([...ids])}`;
  }

  async clearGrantLinks(prId: string): Promise<void> {
    await this.sql`
      update public.pr_line set budget_line_id = null, activity_id = null
      where pr_id = ${prId} and (budget_line_id is not null or activity_id is not null)`;
  }

  async settings(): Promise<TenantSettings> {
    const [row] = await this.sql<
      {
        base_currency: string;
        doa_reference_currency: string;
        timezone: string;
        max_backdate_days: number;
      }[]
    >`
      select base_currency::text as base_currency,
             doa_reference_currency::text as doa_reference_currency, timezone, max_backdate_days
      from public.tenant where id = ${this.tenantId}`;
    if (!row) throw new AppError('NOT_FOUND', 'tenant not found');
    return {
      baseCurrency: row.base_currency,
      doaReferenceCurrency: row.doa_reference_currency,
      timeZone: row.timezone,
      maxBackdateDays: row.max_backdate_days,
    };
  }

  async grant(id: string): Promise<PrGrantRef | null> {
    const [row] = await this.sql<
      {
        id: string;
        currency: string;
        status: PrGrantRef['status'];
        start_date: string;
        end_date: string;
        office_ids: string[];
      }[]
    >`
      select g.id, g.currency::text as currency, g.status, g.start_date::text as start_date,
             g.end_date::text as end_date,
             coalesce((select jsonb_agg(go.office_id) from public.grant_office go
                       where go.grant_id = g.id), '[]'::jsonb) as office_ids
      from public."grant" g where g.id = ${id}`;
    if (!row) return null;
    return {
      id: row.id,
      currency: row.currency,
      status: row.status,
      startDate: row.start_date,
      endDate: row.end_date,
      officeIds: row.office_ids,
    };
  }

  async budgetLineGrants(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.sql<{ id: string; grant_id: string }[]>`
      select id, grant_id from public.budget_line where id in ${this.sql([...new Set(ids)])}`;
    return new Map(rows.map((r) => [r.id, r.grant_id]));
  }

  async activityGrants(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.sql<{ id: string; grant_id: string }[]>`
      select id, grant_id from public.activity where id in ${this.sql([...new Set(ids)])}`;
    return new Map(rows.map((r) => [r.id, r.grant_id]));
  }

  async minorUnits(codes: readonly string[]): Promise<Map<string, number>> {
    if (codes.length === 0) return new Map();
    const rows = await this.sql<{ code: string; minor_units: number }[]>`
      select code::text as code, minor_units from public.currency
      where code in ${this.sql([...new Set(codes)])}`;
    return new Map(rows.map((r) => [r.code, r.minor_units]));
  }

  async actor(userId: string): Promise<ActorSnapshot> {
    const [row] = await this.sql<
      { full_name_ar: string; full_name_en: string; position_title: string | null }[]
    >`
      select full_name_ar, full_name_en, position_title from public.membership
      where tenant_id = ${this.tenantId} and user_id = ${userId}`;
    if (!row) throw new AppError('FORBIDDEN', 'No membership in this organization');
    return { nameAr: row.full_name_ar, nameEn: row.full_name_en, position: row.position_title };
  }

  async printSnapshot(prId: string): Promise<PrintSnapshot> {
    const [row] = await this.sql<{ snapshot: PrintSnapshot }[]>`
      select jsonb_build_object(
        'organization', (
          select jsonb_build_object(
            'nameAr', t.name_ar, 'nameEn', t.name_en, 'logoPath', t.logo_path,
            'address', t.address, 'phone', t.phone, 'email', t.email)
          from public.tenant t where t.id = p.tenant_id),
        'requestingOffice', (
          select jsonb_build_object('code', o.code, 'nameAr', o.name_ar, 'nameEn', o.name_en)
          from public.office o where o.id = p.requesting_office_id),
        'deliverTo', (
          select jsonb_build_object('code', o.code, 'nameAr', o.name_ar, 'nameEn', o.name_en)
          from public.office o where o.id = p.deliver_to_office_id),
        'grant', (
          select jsonb_build_object('code', g.code, 'name', g.name)
          from public."grant" g where g.id = p.grant_id),
        'donor', (
          select jsonb_build_object('name', d.name, 'shortName', d.short_name)
          from public."grant" g join public.donor d on d.id = g.donor_id
          where g.id = p.grant_id),
        'activity', (
          select jsonb_build_object('code', a.code, 'name', a.name)
          from public.activity a where a.id = p.activity_id),
        'requester', (
          select jsonb_build_object(
            'nameAr', m.full_name_ar, 'nameEn', m.full_name_en, 'position', m.position_title)
          from public.membership m
          where m.tenant_id = p.tenant_id and m.user_id = p.requester_id),
        'lines', coalesce((
          select jsonb_object_agg(l.id, jsonb_build_object(
            'unit', (
              select jsonb_build_object('code', u.code, 'nameAr', u.name_ar, 'nameEn', u.name_en)
              from public.unit_of_measure u where u.id = l.unit_id),
            'budgetLineCode', (select b.code from public.budget_line b where b.id = l.budget_line_id),
            'budgetLocation', (
              select jsonb_build_object('code', o.code, 'nameAr', o.name_ar, 'nameEn', o.name_en)
              from public.office o where o.id = l.location_office_id),
            'donorShortName', (
              select coalesce(d.short_name, d.name)
              from public."grant" g join public.donor d on d.id = g.donor_id
              where g.id = p.grant_id)))
          from public.pr_line l where l.pr_id = p.id), '{}'::jsonb)
      ) as snapshot
      from public.purchase_requisition p where p.id = ${prId}`;
    if (!row) throw new AppError('NOT_FOUND', 'purchase_requisition not found');
    return row.snapshot;
  }

  async lockLine(id: string, values: LockedLineValues): Promise<void> {
    await this.sql`
      update public.pr_line set
        rate_to_base = ${values.rateToBase}, rate_date = ${values.rateDate},
        rate_source = ${values.rateSource}, exchange_rate_id = ${values.exchangeRateId},
        amount_grant = ${values.amountGrant}
      where id = ${id}`;
  }

  async markSubmitted(id: string, v: SubmissionValues): Promise<number> {
    const [row] = await this.sql<{ version: number }[]>`
      update public.purchase_requisition set
        number = ${v.number}, status = 'pending_finance_check',
        submission_cycle = ${v.submissionCycle}, current_step_order = ${v.currentStepOrder},
        submitted_at = ${v.submittedAt}, requester_name = ${v.requesterName},
        requester_position = ${v.requesterPosition},
        doa_currency = ${v.doaCurrency}, doa_amount = ${v.doaAmount},
        doa_rate_to_base = ${v.doaRateToBase}, doa_rate_date = ${v.doaRateDate},
        doa_rate_source = ${v.doaRateSource}, doa_exchange_rate_id = ${v.doaExchangeRateId},
        grant_rate_to_base = ${v.grantRateToBase}, grant_rate_date = ${v.grantRateDate},
        grant_rate_source = ${v.grantRateSource},
        grant_exchange_rate_id = ${v.grantExchangeRateId},
        total_grant_currency = ${v.totalGrantCurrency},
        print_snapshot = ${this.sql.json(v.printSnapshot as unknown as postgresJson)}
      where id = ${id} returning version`;
    if (!row) throw new AppError('NOT_FOUND', 'purchase_requisition not found');
    return row.version;
  }
}

type postgresJson = Parameters<TxSql['json']>[0];
