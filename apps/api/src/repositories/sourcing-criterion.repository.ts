// sourcing_criterion: essential (pass/fail) and weighted criteria per stage (data-model §4).
// A draft replaces the whole set; weights per stage must total 100 before issue (FR-017).
import type {
  CriterionKind,
  CriterionStage,
  SourcingCriterionInput,
  SourcingCriterionView,
} from '@ngo/shared';
import type { TxSql } from '../db/tx';

interface Row {
  id: string;
  sort_order: number;
  stage: CriterionStage;
  kind: CriterionKind;
  code: string;
  name_ar: string;
  name_en: string;
  weight_pct: string | null;
  is_price: boolean;
}

const toView = (r: Row): SourcingCriterionView => ({
  id: r.id,
  sortOrder: r.sort_order,
  stage: r.stage,
  kind: r.kind,
  code: r.code,
  nameAr: r.name_ar,
  nameEn: r.name_en,
  weightPct: r.weight_pct,
  isPrice: r.is_price,
});

export class SourcingCriterionRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async list(eventId: string): Promise<SourcingCriterionView[]> {
    const rows = await this.sql<Row[]>`
      select id, sort_order, stage, kind, code, name_ar, name_en, weight_pct::text, is_price
      from public.sourcing_criterion
      where tenant_id = ${this.tenantId} and sourcing_event_id = ${eventId}
      order by stage, sort_order, code`;
    return rows.map(toView);
  }

  async replace(eventId: string, criteria: readonly SourcingCriterionInput[]): Promise<void> {
    const sql = this.sql;
    await sql`
      delete from public.sourcing_criterion
      where tenant_id = ${this.tenantId} and sourcing_event_id = ${eventId}`;
    if (criteria.length === 0) return;
    await sql`
      insert into public.sourcing_criterion ${sql(
        criteria.map((c, i) => ({
          tenant_id: this.tenantId,
          sourcing_event_id: eventId,
          sort_order: i + 1,
          stage: c.stage ?? 'single',
          kind: c.kind,
          code: c.code,
          name_ar: c.nameAr,
          name_en: c.nameEn,
          weight_pct: c.kind === 'weighted' ? (c.weightPct ?? null) : null,
          is_price: c.isPrice ?? false,
        }))
      )}`;
  }
}
