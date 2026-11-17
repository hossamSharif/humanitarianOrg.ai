// unsuccessful_notice (data-model §4, FR-031): one row per valid offer that was not awarded,
// created as a placeholder at award approval and completed when the supplier is told.
import type { TxSql } from '../db/tx';

export class UnsuccessfulNoticeRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  /** Placeholders for every valid, unawarded offer of the analysis' event. */
  async createPlaceholders(analysisId: string, eventId: string): Promise<void> {
    await this.sql`
      insert into public.unsuccessful_notice (tenant_id, bid_analysis_id, offer_id)
      select ${this.tenantId}, ${analysisId}, o.id
      from public.offer o
      where o.tenant_id = ${this.tenantId} and o.sourcing_event_id = ${eventId}
        and o.status in ('logged', 'late_accepted', 'disqualified')
        and not exists (
          select 1 from public.award_line a
          where a.bid_analysis_id = ${analysisId} and a.offer_id = o.id
        )
      on conflict (bid_analysis_id, offer_id) do nothing`;
  }

  async record(
    analysisId: string,
    notice: { offerId: string; notifiedOn: string; channel: string }
  ): Promise<boolean> {
    const rows = await this.sql`
      update public.unsuccessful_notice
      set notified_on = ${notice.notifiedOn}, channel = ${notice.channel}
      where tenant_id = ${this.tenantId} and bid_analysis_id = ${analysisId}
        and offer_id = ${notice.offerId}
      returning id`;
    return rows.length > 0;
  }

  async list(
    analysisId: string
  ): Promise<{ offerId: string; notifiedOn: string | null; channel: string | null }[]> {
    const rows = await this.sql<
      { offer_id: string; notified_on: string | null; channel: string | null }[]
    >`
      select offer_id, notified_on::text, channel from public.unsuccessful_notice
      where tenant_id = ${this.tenantId} and bid_analysis_id = ${analysisId}
      order by created_at`;
    return rows.map((r) => ({
      offerId: r.offer_id,
      notifiedOn: r.notified_on,
      channel: r.channel,
    }));
  }
}
