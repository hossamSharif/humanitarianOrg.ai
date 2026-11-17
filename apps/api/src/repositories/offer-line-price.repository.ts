// offer_line_price (SEALED, data-model §4): one unit price per offer and sourcing line, the
// quantity defaulting to the line's (trigger). Deletes are revoked, so prices are upserted;
// the policies admit writes only after the opening, for valid receipts, until the freeze.
import type { TxSql } from '../db/tx';

export interface LinePriceValues {
  sourcingLineId: string;
  unitPrice: string;
  /** null = the sourcing line's quantity */
  quantity: string | null;
}

export class OfferLinePriceRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async upsertMany(
    eventId: string,
    offerId: string,
    prices: readonly LinePriceValues[]
  ): Promise<void> {
    for (const p of prices) {
      // quantity is filled from the sourcing line when null (offer_sealed_guard)
      await this.sql`
        insert into public.offer_line_price
          (tenant_id, offer_id, sourcing_event_id, sourcing_line_id, unit_price, quantity)
        values (${this.tenantId}, ${offerId}, ${eventId}, ${p.sourcingLineId}, ${p.unitPrice},
                ${p.quantity})
        on conflict (offer_id, sourcing_line_id) do update
        set unit_price = excluded.unit_price,
            quantity = coalesce(${p.quantity}::numeric, (
              select l.quantity from public.sourcing_line l where l.id = excluded.sourcing_line_id
            ))`;
    }
  }
}
