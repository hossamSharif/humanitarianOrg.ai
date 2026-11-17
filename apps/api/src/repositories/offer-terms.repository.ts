// offer_terms (SEALED, data-model §4, research D3): read and written through the caller's
// transaction as `authenticated`, so the select and insert policies apply — before the opening
// (or for an undeclared committee member) nothing is returned and nothing can be written.
import { Decimal, type EssentialResult, type OfferTermsView } from '@ngo/shared';
import type { TxSql } from '../db/tx';

type Json = Parameters<TxSql['json']>[0];

export interface OfferTermsValues {
  currency: string;
  deliveryDays: number | null;
  validityDays: number | null;
  paymentTerms: string | null;
  essentialCompliance: Record<string, { result: EssentialResult; note: string | null }>;
}

interface Row {
  offer_id: string;
  currency: string;
  delivery_days: number | null;
  validity_days: number | null;
  payment_terms: string | null;
  essential_compliance: OfferTermsView['essentialCompliance'];
  scan_attachment_id: string | null;
  version: number;
}

interface PriceRow {
  offer_id: string;
  sourcing_line_id: string;
  unit_price: string;
  quantity: string;
  line_total: string;
}

export class OfferTermsRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async upsert(eventId: string, offerId: string, values: OfferTermsValues): Promise<void> {
    const sql = this.sql;
    const compliance = sql.json(values.essentialCompliance as unknown as Json);
    await sql`
      insert into public.offer_terms
        (offer_id, tenant_id, sourcing_event_id, currency, delivery_days, validity_days,
         payment_terms, essential_compliance)
      values (${offerId}, ${this.tenantId}, ${eventId}, ${values.currency},
              ${values.deliveryDays}, ${values.validityDays}, ${values.paymentTerms}, ${compliance})
      on conflict (offer_id) do update
      set currency = excluded.currency,
          delivery_days = excluded.delivery_days,
          validity_days = excluded.validity_days,
          payment_terms = excluded.payment_terms,
          essential_compliance = excluded.essential_compliance`;
  }

  async setScan(offerId: string, attachmentId: string): Promise<boolean> {
    const rows = await this.sql`
      update public.offer_terms set scan_attachment_id = ${attachmentId}
      where tenant_id = ${this.tenantId} and offer_id = ${offerId}
      returning offer_id`;
    return rows.length > 0;
  }

  async exists(offerId: string): Promise<boolean> {
    const [row] = await this.sql<{ offer_id: string }[]>`
      select offer_id from public.offer_terms
      where tenant_id = ${this.tenantId} and offer_id = ${offerId}`;
    return row !== undefined;
  }

  /** Every visible offer's terms and prices of the event (empty while sealed). */
  async list(eventId: string): Promise<OfferTermsView[]> {
    const [terms, prices] = await Promise.all([
      this.sql<Row[]>`
        select offer_id, currency::text, delivery_days, validity_days, payment_terms,
               essential_compliance, scan_attachment_id, version
        from public.offer_terms
        where tenant_id = ${this.tenantId} and sourcing_event_id = ${eventId}`,
      this.sql<PriceRow[]>`
        select p.offer_id, p.sourcing_line_id, p.unit_price::text, p.quantity::text,
               p.line_total::text
        from public.offer_line_price p
        join public.sourcing_line l on l.id = p.sourcing_line_id
        where p.tenant_id = ${this.tenantId} and p.sourcing_event_id = ${eventId}
        order by l.line_no`,
    ]);
    return terms.map((t) => {
      const lines = prices.filter((p) => p.offer_id === t.offer_id);
      const total = lines.reduce((sum, p) => sum.plus(p.line_total), new Decimal(0)).toFixed(2);
      return {
        offerId: t.offer_id,
        currency: t.currency,
        deliveryDays: t.delivery_days,
        validityDays: t.validity_days,
        paymentTerms: t.payment_terms,
        essentialCompliance: t.essential_compliance,
        scanAttachmentId: t.scan_attachment_id,
        linePrices: lines.map((p) => ({
          sourcingLineId: p.sourcing_line_id,
          unitPrice: p.unit_price,
          quantity: p.quantity,
          lineTotal: p.line_total,
        })),
        total,
        version: t.version,
      };
    });
  }
}
