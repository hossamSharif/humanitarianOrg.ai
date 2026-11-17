// analysis_result (data-model §4): the computed snapshot of scoring.ts per offer, and per line
// when the award may be split. Rewritten on every change until the first committee signature;
// the frozen trigger refuses writes after it (FR-029).
import type { AnalysisResultView, OfferResult } from '@ngo/shared';
import type { TxSql } from '../db/tx';

type Json = Parameters<TxSql['json']>[0];

interface Row {
  offer_id: string;
  sourcing_line_id: string | null;
  disqualified: boolean;
  disqualification_reason: string | null;
  total_offer_currency: string | null;
  total_event_currency: string | null;
  price_points: string | null;
  criteria_points: Record<string, string>;
  technical_pass: boolean | null;
  weighted_total: string | null;
  rank: number | null;
}

export class AnalysisResultRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async replace(analysisId: string, results: readonly OfferResult[]): Promise<void> {
    const sql = this.sql;
    await sql`
      delete from public.analysis_result
      where tenant_id = ${this.tenantId} and bid_analysis_id = ${analysisId}`;
    if (results.length === 0) return;
    await sql`
      insert into public.analysis_result ${sql(
        results.map((r) => ({
          tenant_id: this.tenantId,
          bid_analysis_id: analysisId,
          offer_id: r.offerId,
          sourcing_line_id: r.sourcingLineId,
          disqualified: r.disqualified,
          disqualification_reason: r.disqualificationReason,
          total_offer_currency: r.totalOfferCurrency,
          total_event_currency: r.totalEventCurrency,
          price_points: r.pricePoints,
          criteria_points: sql.json(r.criteriaPoints as unknown as Json),
          technical_pass: r.technicalPass,
          weighted_total: r.weightedTotal,
          rank: r.rank,
        }))
      )}`;
  }

  async list(analysisId: string): Promise<AnalysisResultView[]> {
    const rows = await this.sql<Row[]>`
      select r.offer_id, r.sourcing_line_id, r.disqualified, r.disqualification_reason,
             r.total_offer_currency::text, r.total_event_currency::text, r.price_points::text,
             r.criteria_points, r.technical_pass, r.weighted_total::text, r.rank
      from public.analysis_result r
      left join public.sourcing_line l on l.id = r.sourcing_line_id
      where r.tenant_id = ${this.tenantId} and r.bid_analysis_id = ${analysisId}
      order by l.line_no nulls first, r.rank nulls last`;
    return rows.map((r) => ({
      offerId: r.offer_id,
      sourcingLineId: r.sourcing_line_id,
      disqualified: r.disqualified,
      disqualificationReason: r.disqualification_reason,
      totalOfferCurrency: r.total_offer_currency,
      totalEventCurrency: r.total_event_currency,
      pricePoints: r.price_points,
      criteriaPoints: r.criteria_points,
      technicalPass: r.technical_pass,
      weightedTotal: r.weighted_total,
      rank: r.rank,
    }));
  }
}
