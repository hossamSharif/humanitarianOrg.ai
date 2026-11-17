// Reads behind the timeline of any 002 document (R30): its audit_history rows by doc_type /
// doc_id, its doc_signature rows with the step kind, and the actors' names. Readable for
// documents the caller can read (RLS: app.can_read_doc).
import type { DocTypeCode } from '@ngo/shared';
import type { TxSql } from '../db/tx';
import { DocRegistryRepository } from './doc-registry.repository';

export interface DocAuditRow {
  id: string;
  tableName: string;
  action: 'insert' | 'update' | 'delete';
  actorId: string | null;
  occurredAt: string;
  fromState: string | null;
  toState: string | null;
  changedFields: string[];
  oldData: Record<string, string | null> | null;
  newData: Record<string, string | null> | null;
}

export interface DocSignatureRow {
  id: string;
  action: string;
  userId: string;
  userName: string;
  userPosition: string | null;
  comment: string | null;
  payload: Record<string, unknown> | null;
  cycle: number;
  stepKind: string | null;
  actedAt: string;
}

export interface DocActorLabel {
  nameAr: string;
  nameEn: string;
  position: string | null;
}

export interface DocHistoryStore {
  exists(docType: DocTypeCode, docId: string): Promise<boolean>;
  auditRows(docType: DocTypeCode, docId: string): Promise<DocAuditRow[]>;
  signatures(docType: DocTypeCode, docId: string): Promise<DocSignatureRow[]>;
  actors(userIds: readonly string[]): Promise<Map<string, DocActorLabel>>;
}

export class DocHistoryRepository implements DocHistoryStore {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async exists(docType: DocTypeCode, docId: string): Promise<boolean> {
    return (await new DocRegistryRepository(this.sql).header(docType, docId)) !== null;
  }

  auditRows(docType: DocTypeCode, docId: string): Promise<DocAuditRow[]> {
    return this.sql<DocAuditRow[]>`
      select h.id::text as "id", h.table_name as "tableName", h.action as "action",
             h.actor_id as "actorId", to_json(h.occurred_at)#>>'{}' as "occurredAt",
             h.from_state as "fromState", h.to_state as "toState",
             coalesce(h.changed_fields, '{}') as "changedFields",
             (select jsonb_object_agg(e.key, e.value) from jsonb_each_text(h.old_data) e)
               as "oldData",
             (select jsonb_object_agg(e.key, e.value) from jsonb_each_text(h.new_data) e)
               as "newData"
      from public.audit_history h
      where h.tenant_id = ${this.tenantId} and h.doc_type = ${docType} and h.doc_id = ${docId}
      order by h.occurred_at, h.id`;
  }

  signatures(docType: DocTypeCode, docId: string): Promise<DocSignatureRow[]> {
    return this.sql<DocSignatureRow[]>`
      select a.id, a.action, a.user_id as "userId", a.user_name as "userName",
             a.user_position as "userPosition", a.comment, a.payload, a.cycle,
             s.kind as "stepKind", to_json(a.acted_at)#>>'{}' as "actedAt"
      from public.doc_signature a
      left join public.doc_approval_step s on s.id = a.step_id
      where a.tenant_id = ${this.tenantId} and a.doc_type = ${docType} and a.doc_id = ${docId}
      order by a.acted_at, a.created_at`;
  }

  async actors(userIds: readonly string[]): Promise<Map<string, DocActorLabel>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.sql<
      {
        user_id: string;
        full_name_ar: string;
        full_name_en: string;
        position_title: string | null;
      }[]
    >`
      select user_id, full_name_ar, full_name_en, position_title from public.membership
      where tenant_id = ${this.tenantId} and user_id in ${this.sql([...new Set(userIds)])}`;
    return new Map(
      rows.map((r) => [
        r.user_id,
        { nameAr: r.full_name_ar, nameEn: r.full_name_en, position: r.position_title },
      ])
    );
  }
}
