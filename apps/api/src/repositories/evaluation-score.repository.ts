// evaluation_score (data-model §4): member × offer × criterion, 1–5, on weighted non-price
// criteria. The guard trigger refuses undeclared or conflicted members and frozen analyses.
import type { MemberScore } from '@ngo/shared';
import type { TxSql } from '../db/tx';

export class EvaluationScoreRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async upsert(
    analysisId: string,
    memberId: string,
    scores: readonly { offerId: string; criterionId: string; score: number }[]
  ): Promise<void> {
    for (const s of scores) {
      await this.sql`
        insert into public.evaluation_score
          (tenant_id, bid_analysis_id, member_id, offer_id, criterion_id, score)
        values (${this.tenantId}, ${analysisId}, ${memberId}, ${s.offerId}, ${s.criterionId},
                ${s.score})
        on conflict (bid_analysis_id, member_id, offer_id, criterion_id)
        do update set score = excluded.score`;
    }
  }

  /** Scores of the members that may score now (declared, no conflict, not replaced). */
  async eligible(analysisId: string): Promise<MemberScore[]> {
    return this.sql<MemberScore[]>`
      select s.offer_id as "offerId", s.criterion_id as "criterionId", s.score
      from public.evaluation_score s
      join public.committee_member m on m.id = s.member_id
      where s.tenant_id = ${this.tenantId} and s.bid_analysis_id = ${analysisId}
        and m.declared_at is not null and not m.excluded and m.replaced_by_id is null`;
  }

  async ofMember(analysisId: string, memberId: string): Promise<MemberScore[]> {
    return this.sql<MemberScore[]>`
      select offer_id as "offerId", criterion_id as "criterionId", score
      from public.evaluation_score
      where tenant_id = ${this.tenantId} and bid_analysis_id = ${analysisId}
        and member_id = ${memberId}`;
  }
}
