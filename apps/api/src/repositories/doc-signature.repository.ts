// doc_signature: signatures and every other document action, insert-only (002 data-model §1).
// The table has no update/delete grants and a trigger blocks both, so this repository only
// appends and reads. PR rows are written through the 001 view by ApprovalActionRepository.
import type { DocSignatureAction, DocTypeCode } from '@ngo/shared';
import type { TxSql } from '../db/tx';

export interface NewDocSignature {
  docId: string;
  stepId: string | null;
  cycle: number;
  stepOrder: number | null;
  action: DocSignatureAction;
  /** name and position at the moment of acting (signature snapshot) */
  userName: string;
  userPosition: string | null;
  comment: string | null;
  payload: Record<string, unknown> | null;
}

export interface DocSignatureRecord {
  id: string;
  stepId: string | null;
  cycle: number;
  stepOrder: number | null;
  action: string;
  userId: string;
  userName: string;
  userPosition: string | null;
  comment: string | null;
  payload: Record<string, unknown> | null;
  actedAt: string;
}

export interface DocSignatureStore {
  insert(row: NewDocSignature): Promise<void>;
  list(docId: string): Promise<DocSignatureRecord[]>;
}

export class DocSignatureRepository implements DocSignatureStore {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string,
    private readonly docType: DocTypeCode
  ) {}

  async insert(row: NewDocSignature): Promise<void> {
    const payload = row.payload ? this.sql.json(row.payload as Parameters<TxSql['json']>[0]) : null;
    // user_id defaults to auth.uid(): the policy only admits the caller's own actions
    await this.sql`
      insert into public.doc_signature
        (tenant_id, doc_type, doc_id, step_id, cycle, step_order, action, user_name,
         user_position, comment, payload)
      values (${this.tenantId}, ${this.docType}, ${row.docId}, ${row.stepId}, ${row.cycle},
              ${row.stepOrder}, ${row.action}, ${row.userName}, ${row.userPosition},
              ${row.comment}, ${payload})`;
  }

  async list(docId: string): Promise<DocSignatureRecord[]> {
    const rows = await this.sql<
      {
        id: string;
        step_id: string | null;
        cycle: number;
        step_order: number | null;
        action: string;
        user_id: string;
        user_name: string;
        user_position: string | null;
        comment: string | null;
        payload: Record<string, unknown> | null;
        acted_at: string;
      }[]
    >`
      select id, step_id, cycle, step_order, action, user_id, user_name, user_position, comment,
             payload, to_json(acted_at)#>>'{}' as acted_at
      from public.doc_signature
      where tenant_id = ${this.tenantId} and doc_type = ${this.docType} and doc_id = ${docId}
      order by acted_at, created_at, id`;
    return rows.map((r) => ({
      id: r.id,
      stepId: r.step_id,
      cycle: r.cycle,
      stepOrder: r.step_order,
      action: r.action,
      userId: r.user_id,
      userName: r.user_name,
      userPosition: r.user_position,
      comment: r.comment,
      payload: r.payload,
      actedAt: r.acted_at,
    }));
  }
}
