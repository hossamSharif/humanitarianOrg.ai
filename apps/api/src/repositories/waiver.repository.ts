// waiver (data-model §4): the lookup sourcing, award and payment rules use. "An approved waiver
// linked" means an approved waiver covering the document with one of the given reasons. Waiver
// documents themselves (create, submit, approve) arrive with US10.
import type { DocTypeCode } from '@ngo/shared';
import type { TxSql } from '../db/tx';

export type WaiverReason =
  | 'single_source'
  | 'emergency'
  | 'fewer_quotations'
  | 'lower_method'
  | 'expired_document'
  | 'overdue_advance'
  | 'other';

export class WaiverRepository {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async hasApprovedWaiver(
    coveredDocType: DocTypeCode,
    coveredDocId: string,
    reasons: readonly WaiverReason[]
  ): Promise<boolean> {
    const sql = this.sql;
    const [row] = await sql<{ id: string }[]>`
      select id from public.waiver
      where tenant_id = ${this.tenantId} and status = 'approved'
        and covered_doc_type = ${coveredDocType} and covered_doc_id = ${coveredDocId}
        and reason_category = any (${sql.array([...reasons])}::text[])
      limit 1`;
    return row !== undefined;
  }
}
