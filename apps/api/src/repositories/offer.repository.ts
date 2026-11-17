// offer: the receipt log of a sourcing event (data-model §4, research D3). Never sealed: who
// submitted and when is visible before the opening; prices and terms live in the sealed tables.
// A receipt after the deadline is `late` (trigger, never typed).
import type { OfferReceiptView, OfferStatus } from '@ngo/shared';
import type { TxSql } from '../db/tx';
import { AppError } from '../middleware/error';

interface Row {
  id: string;
  supplier_id: string;
  legal_name_ar: string;
  legal_name_en: string;
  received_at: Date;
  received_by: string;
  received_by_name: string | null;
  status: OfferStatus;
  replaces_id: string | null;
  late_acceptance_reason: string | null;
  disqualification_reason: string | null;
  has_terms: boolean;
}

export interface OfferRecord {
  id: string;
  sourcingEventId: string;
  supplierId: string;
  status: OfferStatus;
  receivedAt: string;
}

export class OfferRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  /** The receipt log; `has_terms` is false before the opening (RLS hides the sealed rows). */
  async list(eventId: string): Promise<OfferReceiptView[]> {
    const rows = await this.sql<Row[]>`
      select o.id, o.supplier_id, s.legal_name_ar, s.legal_name_en, o.received_at,
             o.received_by, coalesce(m.full_name_en, m.full_name_ar) as received_by_name,
             o.status, o.replaces_id, o.late_acceptance_reason, o.disqualification_reason,
             exists (select 1 from public.offer_terms t where t.offer_id = o.id) as has_terms
      from public.offer o
      join public.supplier s on s.id = o.supplier_id
      left join public.membership m on m.tenant_id = o.tenant_id and m.user_id = o.received_by
      where o.tenant_id = ${this.tenantId} and o.sourcing_event_id = ${eventId}
      order by o.received_at, o.created_at`;
    return rows.map((r) => ({
      id: r.id,
      supplierId: r.supplier_id,
      supplierNameAr: r.legal_name_ar,
      supplierNameEn: r.legal_name_en,
      receivedAt: r.received_at.toISOString(),
      receivedById: r.received_by,
      receivedByName: r.received_by_name ?? '',
      status: r.status,
      replacesId: r.replaces_id,
      lateAcceptanceReason: r.late_acceptance_reason,
      disqualificationReason: r.disqualification_reason,
      hasTerms: r.has_terms,
    }));
  }

  async get(eventId: string, offerId: string): Promise<OfferRecord> {
    const [row] = await this.sql<
      {
        id: string;
        sourcing_event_id: string;
        supplier_id: string;
        status: OfferStatus;
        received_at: Date;
      }[]
    >`
      select id, sourcing_event_id, supplier_id, status, received_at from public.offer
      where tenant_id = ${this.tenantId} and sourcing_event_id = ${eventId} and id = ${offerId}`;
    if (!row) throw new AppError('NOT_FOUND', 'Offer not found');
    return {
      id: row.id,
      sourcingEventId: row.sourcing_event_id,
      supplierId: row.supplier_id,
      status: row.status,
      receivedAt: row.received_at.toISOString(),
    };
  }

  /** The supplier's current valid receipt (logged or accepted late), locked. */
  async currentValid(eventId: string, supplierId: string): Promise<{ id: string } | null> {
    const [row] = await this.sql<{ id: string }[]>`
      select id from public.offer
      where tenant_id = ${this.tenantId} and sourcing_event_id = ${eventId}
        and supplier_id = ${supplierId} and status in ('logged', 'late_accepted')
      for update`;
    return row ?? null;
  }

  async markReplaced(id: string): Promise<void> {
    await this.sql`
      update public.offer set status = 'replaced'
      where tenant_id = ${this.tenantId} and id = ${id}`;
  }

  /** The status comes from the deadline (trigger). */
  async insert(values: {
    eventId: string;
    supplierId: string;
    receivedAt: string;
    receivedById: string;
    replacesId: string | null;
  }): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.offer
        (tenant_id, sourcing_event_id, supplier_id, received_at, received_by, replaces_id)
      values (${this.tenantId}, ${values.eventId}, ${values.supplierId}, ${values.receivedAt},
              ${values.receivedById}, ${values.replacesId})
      returning id`;
    return row!.id;
  }

  async acceptLate(eventId: string, offerId: string, reason: string): Promise<boolean> {
    const rows = await this.sql`
      update public.offer set status = 'late_accepted', late_acceptance_reason = ${reason}
      where tenant_id = ${this.tenantId} and sourcing_event_id = ${eventId} and id = ${offerId}
        and status = 'late'
      returning id`;
    return rows.length > 0;
  }

  async countValid(eventId: string): Promise<number> {
    const [row] = await this.sql<{ n: number }[]>`
      select count(*)::int as n from public.offer
      where tenant_id = ${this.tenantId} and sourcing_event_id = ${eventId}
        and status in ('logged', 'late_accepted')`;
    return row?.n ?? 0;
  }

  /** The receiver is a member of the organization. */
  async isMember(userId: string): Promise<boolean> {
    const [row] = await this.sql<{ id: string }[]>`
      select id from public.membership
      where tenant_id = ${this.tenantId} and user_id = ${userId} and status = 'active'`;
    return row !== undefined;
  }
}
